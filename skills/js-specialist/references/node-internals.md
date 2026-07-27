# Node.js Internals Reference

## Table of Contents

1. [Event Loop Deep Dive](#event-loop-deep-dive)
2. [V8 Engine Internals](#v8-engine-internals)
3. [Streams](#streams)
4. [Worker Threads](#worker-threads)
5. [Cluster Module](#cluster-module)
6. [Child Processes](#child-processes)
7. [Memory Model](#memory-model)
8. [Module System](#module-system)

---

## Event Loop Deep Dive

### Phase Order (libuv)

```
   ┌───────────────────────────┐
┌─>│         timers             │  ← setTimeout, setInterval callbacks
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │     pending callbacks      │  ← I/O callbacks deferred from previous loop
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │       idle, prepare        │  ← internal use only
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │          poll              │  ← retrieve new I/O events, execute I/O callbacks
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │          check             │  ← setImmediate callbacks
│  └─────────────┬─────────────┘
│  ┌─────────────┴─────────────┐
│  │      close callbacks       │  ← socket.on('close', ...)
│  └───────────────────────────┘
```

### Microtasks vs Macrotasks

**Microtasks** (run between each macrotask, drain completely):
- `Promise.then/catch/finally`
- `queueMicrotask()`
- `process.nextTick()` (runs before other microtasks)

**Macrotasks** (one per event loop iteration):
- `setTimeout` / `setInterval`
- `setImmediate`
- I/O callbacks
- UI rendering (browser)

### Execution Order

```javascript
console.log('1 - sync');
setTimeout(() => console.log('2 - timeout'), 0);
setImmediate(() => console.log('3 - immediate'));
Promise.resolve().then(() => console.log('4 - promise'));
process.nextTick(() => console.log('5 - nextTick'));
// Output: 1-sync, 5-nextTick, 4-promise, 2-timeout OR 3-immediate (order varies), then the other
```

**Rules:**
- `process.nextTick` always runs before Promise microtasks
- `setTimeout(fn, 0)` vs `setImmediate`: order is non-deterministic in main module, but within an I/O callback `setImmediate` always fires first
- Recursive `nextTick` can starve the event loop — use `setImmediate` for yielding

### Event Loop Blocking

**Never block the event loop with:**
- Synchronous file I/O (`fs.readFileSync`) in request handlers
- CPU-intensive computation (>10ms) in the main thread
- Large JSON parsing (`JSON.parse` on large strings)
- Complex regex on user input (ReDoS risk)

**Solutions:**
- Use async I/O (`fs.promises`)
- Offload CPU work to Worker Threads
- Stream large data instead of buffering
- Use `setImmediate` to break up long computations

---

## V8 Engine Internals

### Memory Layout

```
V8 Heap
├── New Space (Young Generation) — ~1-8MB
│   ├── Semi-space A (from-space)
│   └── Semi-space B (to-space)
│   └── Minor GC (Scavenge): fast, frequent, copies live objects
├── Old Space (Old Generation) — up to --max-old-space-size
│   └── Major GC (Mark-Sweep-Compact): slower, less frequent
├── Large Object Space — objects > 1MB
├── Code Space — compiled code (JIT)
└── Map Space — hidden classes (shapes)
```

### Hidden Classes (Shapes/Maps)
V8 creates hidden classes for object shapes. Objects with the same shape share a hidden class → faster property access.

```javascript
// GOOD: consistent shape — one hidden class
function createUser(name, age) {
  return { name, age }; // Always same shape
}

// BAD: inconsistent shape — multiple hidden classes
function createUser(name, age) {
  const user = {};
  user.name = name;
  if (age) user.age = age; // Sometimes has age, sometimes doesn't
  return user;
}
```

**Rules for fast V8 execution:**
- Initialize all properties in the constructor/factory
- Don't add/delete properties after creation
- Keep property order consistent
- Avoid `delete` operator (use `undefined` assignment instead)
- Use monomorphic functions (same argument types every call)

### JIT Compilation Pipeline

```
JavaScript Source
    ↓
Ignition (Interpreter) — baseline bytecode, fast startup
    ↓ (hot functions detected via profiling)
TurboFan (Optimizing Compiler) — optimized machine code
    ↓ (if assumptions violated)
Deoptimization → back to Ignition
```

**Deoptimization triggers:**
- Changing object shapes (hidden class mismatch)
- Polymorphic call sites (function called with different types)
- `arguments` object in optimized code
- `try/catch` (V8 has improved, but still less optimizable)
- `eval` / `with` statements

---

## Streams

### Stream Types

| Type | Description | Example |
|------|------------|---------|
| `Readable` | Source of data | `fs.createReadStream`, `http.IncomingMessage` |
| `Writable` | Destination for data | `fs.createWriteStream`, `http.ServerResponse` |
| `Duplex` | Both readable and writable | `net.Socket`, `zlib` streams |
| `Transform` | Duplex that modifies data passing through | `zlib.createGzip`, custom parsers |

### Stream Best Practices

```javascript
// GOOD: pipe handles backpressure automatically
import { pipeline } from 'stream/promises';

await pipeline(
  fs.createReadStream('input.csv'),
  zlib.createGzip(),
  fs.createWriteStream('output.csv.gz')
);

// BAD: manual pipe without error handling
readStream.pipe(transformStream).pipe(writeStream);
// If one stream errors, others are not cleaned up
```

**Rules:**
- Always use `pipeline()` (not `.pipe()`) — handles errors and cleanup
- Use `stream/promises` for async/await compatibility
- Implement `_destroy()` in custom streams for cleanup
- Set `highWaterMark` based on memory constraints (default 16KB for streams, 16 objects for object mode)
- Use `for await...of` to consume readable streams

### When to Use Streams
- File processing larger than available memory
- HTTP request/response bodies
- Real-time data transformation
- Piping between I/O sources (file → HTTP, DB → file)

---

## Worker Threads

### When to Use
- CPU-intensive computation (image processing, crypto, parsing)
- Tasks > 10ms that would block the event loop
- Parallel processing of independent data chunks

### When NOT to Use
- I/O-bound work (use async I/O instead — it's already non-blocking)
- Simple tasks (worker creation overhead ~5-10ms)
- Shared mutable state (use message passing instead)

### Pattern: Worker Pool

```javascript
import { Worker } from 'worker_threads';
import os from 'os';

class WorkerPool {
  #workers = [];
  #queue = [];

  constructor(workerFile, poolSize = os.cpus().length) {
    for (let i = 0; i < poolSize; i++) {
      this.#addWorker(workerFile);
    }
  }

  #addWorker(file) {
    const worker = new Worker(file);
    worker.on('message', (result) => {
      worker.__resolve(result);
      worker.__busy = false;
      this.#processQueue();
    });
    worker.__busy = false;
    this.#workers.push(worker);
  }

  exec(data) {
    return new Promise((resolve) => {
      const idle = this.#workers.find(w => !w.__busy);
      if (idle) {
        idle.__busy = true;
        idle.__resolve = resolve;
        idle.postMessage(data);
      } else {
        this.#queue.push({ data, resolve });
      }
    });
  }

  #processQueue() {
    if (this.#queue.length === 0) return;
    const { data, resolve } = this.#queue.shift();
    const idle = this.#workers.find(w => !w.__busy);
    if (idle) {
      idle.__busy = true;
      idle.__resolve = resolve;
      idle.postMessage(data);
    }
  }
}
```

### Data Sharing
- **`SharedArrayBuffer`**: Share raw memory between threads (requires `Atomics` for synchronization)
- **`MessagePort`**: Message passing (structured clone — copies data)
- **`transferList`**: Transfer ownership of ArrayBuffers (zero-copy)

---

## Cluster Module

### When to Use
- HTTP servers that need to use all CPU cores
- Want to restart workers on crash without downtime
- Simple multi-process scaling (no shared state needed)

```javascript
import cluster from 'cluster';
import os from 'os';

if (cluster.isPrimary) {
  const numWorkers = os.cpus().length;
  for (let i = 0; i < numWorkers; i++) cluster.fork();
  cluster.on('exit', (worker) => {
    console.log(`Worker ${worker.process.pid} died, restarting`);
    cluster.fork();
  });
} else {
  // Each worker runs the HTTP server
  startServer();
}
```

**Cluster vs Worker Threads:**
- Cluster: separate processes, separate memory, good for HTTP servers
- Worker Threads: same process, can share memory, good for CPU tasks

---

## Child Processes

| Method | Use Case | Stdio |
|--------|---------|-------|
| `exec` | Run shell command, get stdout as string | Buffered |
| `execFile` | Run executable directly (no shell, safer) | Buffered |
| `spawn` | Long-running process, stream stdio | Streamed |
| `fork` | Spawn Node.js process with IPC channel | IPC + stdio |

```javascript
import { spawn } from 'child_process';

// Stream output for long-running processes
const proc = spawn('ffmpeg', ['-i', 'input.mp4', 'output.webm']);
proc.stdout.on('data', (chunk) => { /* stream output */ });
proc.on('close', (code) => { /* handle exit */ });
```

**Security:** Never pass user input directly to `exec` — use `execFile` or `spawn` with args array to prevent command injection.

---

## Memory Model

### Memory Limits
- Default: ~1.5GB on 64-bit (V8 old space limit)
- Increase: `--max-old-space-size=4096` (in MB)
- Monitor: `process.memoryUsage()` returns `{ rss, heapTotal, heapUsed, external, arrayBuffers }`

### Common Memory Leak Sources
1. **Global variables** — Accidental globals from missing `const`/`let`
2. **Closures holding references** — Inner functions retaining outer scope
3. **Event listeners not removed** — `.on()` without `.off()`
4. **Caches without eviction** — Maps/objects growing indefinitely
5. **Circular references in closures** — Not GC'd due to closure retention
6. **Detached DOM nodes** (browser) — Removed from DOM but referenced in JS

### Detecting Leaks
- `--inspect` + Chrome DevTools heap snapshots
- `process.memoryUsage()` over time (heapUsed growing steadily = leak)
- `--expose-gc` + `global.gc()` for manual GC in tests

---

## Module System

### ESM vs CommonJS

| Feature | CommonJS (`require`) | ESM (`import`) |
|---------|---------------------|----------------|
| Loading | Synchronous | Asynchronous |
| Tree-shaking | No | Yes |
| Top-level await | No | Yes |
| `__dirname`/`__filename` | Available | Use `import.meta.url` |
| Dynamic import | `require()` | `import()` |
| Circular deps | Partial exports at time of require | Live bindings (always current) |

### ESM in Node.js
- `"type": "module"` in package.json → `.js` files are ESM
- Or use `.mjs` extension
- `__dirname` replacement: `import.meta.dirname` (Node 21.2+) or `path.dirname(fileURLToPath(import.meta.url))`
- Use `import()` for conditional/dynamic imports
