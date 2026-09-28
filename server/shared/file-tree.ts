import { promises as fsPromises } from 'fs';
import path from 'path';

export interface FileTreeItem {
  name: string;
  path: string;
  type: 'directory' | 'file';
  size?: number;
  modified?: string | null;
  isSymlink?: boolean;
  permissions?: string;
  permissionsRwx?: string;
  children?: FileTreeItem[];
  /** Set when the entry budget ran out before this directory was fully listed. */
  truncated?: boolean;
}

interface WalkBudget {
  remaining: number;
}

// Directories that are almost never interesting for a project tree but can
// contain tens of thousands of files. Skipping them before recursion keeps
// traversal time bounded on large monorepos and high-latency filesystems
// (NFS / SMB).
const IGNORED_DIRS = new Set([
  // JS / TS toolchains
  'node_modules', 'dist', 'build', '.next', '.nuxt', '.cache', '.parcel-cache',
  // VCS
  '.git', '.svn', '.hg',
  // Python
  '__pycache__', '.pytest_cache', '.mypy_cache', '.tox', 'venv', '.venv',
  // Rust / Go / Java / Ruby
  'target', 'vendor',
  // Build output / IDE
  '.gradle', '.idea', 'coverage', '.nyc_output',
]);

const parsePositiveInt = (raw: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(raw || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const FS_CONCURRENCY = parsePositiveInt(process.env.FS_CONCURRENCY, 64);

// Hard cap on entries a single tree request may return. Walking a workspace
// root that holds dozens of repositories would otherwise allocate millions of
// items, pin the event loop in GC and stall every other request on the server.
export const FILE_TREE_MAX_ENTRIES = parsePositiveInt(process.env.FILE_TREE_MAX_ENTRIES, 50_000);

/**
 * FIFO of waiters with O(1) dequeue. `Array.prototype.shift` is O(n) once the
 * array leaves V8's fast path, and a large tree walk queues tens of thousands
 * of waiters at once, so a plain array turned every permit hand-off into a
 * full memmove.
 */
class WaiterQueue {
  private items: Array<() => void> = [];
  private head = 0;

  get length(): number {
    return this.items.length - this.head;
  }

  push(resolve: () => void): void {
    this.items.push(resolve);
  }

  shift(): (() => void) | undefined {
    if (this.head >= this.items.length) {
      return undefined;
    }
    const next = this.items[this.head];
    this.items[this.head] = undefined as unknown as () => void;
    this.head += 1;
    if (this.head > 1024 && this.head * 2 >= this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
    return next;
  }
}

let activeFsOperations = 0;
const pendingFsOperations = new WaiterQueue();

async function acquire(): Promise<void> {
  if (activeFsOperations < FS_CONCURRENCY) {
    activeFsOperations += 1;
    return;
  }
  await new Promise<void>((resolve) => {
    pendingFsOperations.push(resolve);
  });
}

function release(): void {
  const next = pendingFsOperations.shift();
  if (next) {
    next();
    return;
  }
  activeFsOperations = Math.max(0, activeFsOperations - 1);
}

const permToRwx = (perm: number): string =>
  (perm & 4 ? 'r' : '-') + (perm & 2 ? 'w' : '-') + (perm & 1 ? 'x' : '-');

const compareItems = (a: FileTreeItem, b: FileTreeItem): number => {
  if (a.type !== b.type) {
    return a.type === 'directory' ? -1 : 1;
  }
  return a.name.localeCompare(b.name);
};

async function statItem(item: FileTreeItem): Promise<void> {
  try {
    await acquire();
    try {
      const stats = await fsPromises.lstat(item.path);
      item.size = stats.size;
      item.modified = stats.mtime.toISOString();
      if (stats.isSymbolicLink()) {
        item.isSymlink = true;
      }
      const mode = stats.mode;
      const owner = (mode >> 6) & 7;
      const group = (mode >> 3) & 7;
      const other = mode & 7;
      item.permissions = `${owner}${group}${other}`;
      item.permissionsRwx = permToRwx(owner) + permToRwx(group) + permToRwx(other);
    } finally {
      release();
    }
  } catch {
    item.size = 0;
    item.modified = null;
    item.permissions = '000';
    item.permissionsRwx = '---------';
  }
}

async function walk(
  dirPath: string,
  maxDepth: number,
  currentDepth: number,
  showHidden: boolean,
  budget: WalkBudget,
): Promise<FileTreeItem[]> {
  let entries;
  try {
    await acquire();
    try {
      entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
    } finally {
      release();
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EACCES' && code !== 'EPERM') {
      console.error('Error reading directory:', error);
    }
    return [];
  }

  let filtered = entries.filter((entry) => !(entry.isDirectory() && IGNORED_DIRS.has(entry.name)));
  if (filtered.length > budget.remaining) {
    filtered = filtered.slice(0, Math.max(0, budget.remaining));
  }
  budget.remaining -= filtered.length;

  // Every entry is processed in parallel: on high-latency filesystems serial
  // stat() was the real bottleneck, and the recursive calls overlap too.
  const items = await Promise.all(filtered.map(async (entry) => {
    const item: FileTreeItem = {
      name: entry.name,
      path: path.join(dirPath, entry.name),
      type: entry.isDirectory() ? 'directory' : 'file',
    };
    await statItem(item);

    if (entry.isDirectory() && currentDepth < maxDepth) {
      if (budget.remaining <= 0) {
        item.truncated = true;
      } else {
        // Permits are only held across a single readdir/lstat, never across a
        // subtree: holding one for the whole recursion deadlocks once sibling
        // directories wait on their own children.
        item.children = await walk(item.path, maxDepth, currentDepth + 1, showHidden, budget);
        if (budget.remaining <= 0) {
          item.truncated = true;
        }
      }
    }
    return item;
  }));

  return items.sort(compareItems);
}

/**
 * Recursively list `dirPath` up to `maxDepth`, skipping build/VCS folders.
 * Stops descending once `maxEntries` items were produced and flags the
 * directories whose contents were cut with `truncated: true`.
 */
export async function getFileTree(
  dirPath: string,
  maxDepth = 3,
  currentDepth = 0,
  showHidden = true,
  maxEntries: number = FILE_TREE_MAX_ENTRIES,
): Promise<FileTreeItem[]> {
  return walk(dirPath, maxDepth, currentDepth, showHidden, { remaining: maxEntries });
}
