# JavaScript Runtime Ecosystem

## Table of Contents

1. [Runtime Comparison](#runtime-comparison)
2. [Node.js Specifics](#nodejs-specifics)
3. [Bun](#bun)
4. [Deno](#deno)
5. [Browser Runtime](#browser-runtime)
6. [Web APIs Available Everywhere](#web-apis-available-everywhere)
7. [Choosing the Right Runtime](#choosing-the-right-runtime)

---

## Runtime Comparison

| Feature | Node.js | Bun | Deno | Browser |
|---------|---------|-----|------|---------|
| Engine | V8 | JavaScriptCore | V8 | V8/SpiderMonkey/JSC |
| TypeScript | Via transpiler | Native | Native | Via bundler |
| Package manager | npm/pnpm/yarn | Built-in (npm compatible) | Built-in (npm + URL imports) | N/A (bundler) |
| Module system | CJS + ESM | CJS + ESM | ESM only | ESM |
| Start-up speed | Moderate | Fast | Moderate | N/A |
| Built-in test runner | `node --test` | `bun test` | `deno test` | N/A |
| Built-in bundler | No | Yes | No | N/A |
| Ecosystem size | Largest | npm compatible | npm compatible | N/A |
| Production maturity | Highest | Growing | Growing | Highest |

---

## Node.js Specifics

### Version Selection
- **LTS (Long Term Support)**: Use for production. Even-numbered releases (18, 20, 22).
- **Current**: Latest features, not recommended for production.
- Always use the latest LTS unless a dependency requires an older version.

### Key Built-in Modules

| Module | Purpose | Notes |
|--------|---------|-------|
| `fs/promises` | File system (async) | Always use over callback `fs` |
| `path` | Path manipulation | `path.join`, `path.resolve` — cross-platform |
| `url` | URL parsing | Use `URL` class (WHATWG) |
| `crypto` | Cryptography | `randomUUID`, `randomBytes`, hashing |
| `stream/promises` | Stream utilities | `pipeline`, `finished` |
| `worker_threads` | CPU parallelism | Worker pool for heavy computation |
| `cluster` | Process parallelism | Multi-core HTTP servers |
| `util` | Utilities | `promisify`, `styleText`, `parseArgs` |
| `events` | EventEmitter | Base for event-driven patterns |
| `http/https` | HTTP server/client | Use framework (Fastify) or `fetch` |
| `assert` | Assertions | Use for testing: `assert/strict` |
| `test` | Test runner | `node:test` — built-in, no dependencies |
| `perf_hooks` | Performance | `performance.now()`, PerformanceObserver |

### Modern Node.js Features (Often Overlooked)

```javascript
// Built-in fetch (Node 18+)
const res = await fetch('https://api.example.com/data');

// Built-in test runner (Node 18+)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Built-in watch mode (Node 18+)
// node --watch app.js

// Import attributes (Node 21+)
import data from './data.json' with { type: 'json' };

// import.meta.dirname (Node 21.2+)
const dir = import.meta.dirname; // Replaces __dirname in ESM

// Structured clone (Node 17+)
const copy = structuredClone(complexObject);

// crypto.randomUUID (Node 19+)
const id = crypto.randomUUID();

// util.parseArgs (Node 18.3+)
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { port: { type: 'string', default: '3000' } } });

// AbortController (Node 15+)
const controller = new AbortController();
setTimeout(() => controller.abort(), 5000);
```

---

## Bun

### When Bun Wins
- **Startup speed**: 4-5x faster than Node.js for scripts and CLI tools
- **TypeScript**: Runs `.ts` files directly without build step
- **Package install**: `bun install` is significantly faster than npm
- **Bundling**: Built-in bundler (`bun build`) — no Webpack/esbuild needed
- **SQLite**: Built-in SQLite driver (`bun:sqlite`)
- **Testing**: `bun test` is Jest-compatible and faster

### When to Stick with Node.js over Bun
- Production stability matters (Node.js has 15+ years of battle-testing)
- Need native addon support (N-API) — Bun support is incomplete
- Complex Worker Threads usage — Bun's implementation differs
- Team requires maximum ecosystem compatibility
- Enterprise environment requiring LTS guarantees

### Bun-Specific APIs
```javascript
// Built-in SQLite
import { Database } from 'bun:sqlite';
const db = new Database('mydb.sqlite');

// Fast file I/O
const file = Bun.file('data.txt');
const text = await file.text();

// Built-in HTTP server
Bun.serve({
  port: 3000,
  fetch(req) {
    return new Response('Hello');
  },
});

// Shell scripting
import { $ } from 'bun';
const result = await $`ls -la`.text();
```

---

## Deno

### When Deno Wins
- **Security**: Permissions system (no file/network access by default)
- **TypeScript**: First-class, zero config
- **Standard library**: Audited, high-quality `@std` modules
- **URL imports**: Import directly from URLs (like Go)
- **Deploy to edge**: Deno Deploy for globally distributed apps

### When to Stick with Node.js over Deno
- Large existing Node.js codebase
- Heavy dependency on npm ecosystem (improving but gaps exist)
- Team familiarity with Node.js
- Need specific npm packages with native addons

### Deno-Specific Features
```typescript
// Permission-based security
// deno run --allow-read --allow-net app.ts

// URL imports
import { serve } from 'https://deno.land/std/http/server.ts';

// npm compatibility
import express from 'npm:express';

// Built-in formatter and linter
// deno fmt
// deno lint

// Built-in KV store
const kv = await Deno.openKv();
await kv.set(['users', '1'], { name: 'Alice' });
```

---

## Browser Runtime

### Key Differences from Node.js

| Feature | Node.js | Browser |
|---------|---------|---------|
| Global | `global` / `globalThis` | `window` / `globalThis` |
| Module loading | `require` or `import` | `<script type="module">` or bundled |
| File access | `fs` module | File API (user-initiated only) |
| Network | `http`, `net`, `fetch` | `fetch`, `XMLHttpRequest`, WebSocket |
| Threads | Worker Threads | Web Workers |
| Storage | File system, databases | localStorage, IndexedDB, Cache API |

### Browser-Only APIs Worth Knowing

| API | Purpose |
|-----|---------|
| `IntersectionObserver` | Lazy loading, infinite scroll |
| `ResizeObserver` | Responsive behavior without polling |
| `MutationObserver` | Watch DOM changes |
| `Web Workers` | Background threads (no DOM access) |
| `Service Workers` | Offline support, push notifications, background sync |
| `Cache API` | Programmatic HTTP cache |
| `IndexedDB` | Client-side structured storage (large data) |
| `Web Crypto` | `crypto.subtle` for encryption/hashing |
| `Streams API` | Same Streams concept as Node.js |
| `AbortController` | Cancel fetch, events, async operations |
| `structuredClone` | Deep copy objects |
| `Broadcast Channel` | Cross-tab communication |
| `WebSocket` | Real-time bidirectional communication |
| `Performance API` | Timing, marks, measures |

---

## Web APIs Available Everywhere

These APIs work in Node.js, Bun, Deno, and browsers:

| API | Availability |
|-----|-------------|
| `fetch` | Node 18+, Bun, Deno, Browsers |
| `URL` / `URLSearchParams` | All runtimes |
| `AbortController` / `AbortSignal` | All runtimes |
| `structuredClone` | Node 17+, Bun, Deno, Browsers |
| `crypto.randomUUID` | Node 19+, Bun, Deno, Browsers |
| `TextEncoder` / `TextDecoder` | All runtimes |
| `ReadableStream` / `WritableStream` | All runtimes (Node 18+) |
| `performance.now()` | All runtimes |
| `queueMicrotask` | All runtimes |
| `globalThis` | All runtimes |
| `Blob` | Node 18+, Bun, Deno, Browsers |
| `FormData` | Node 18+, Bun, Deno, Browsers |
| `Headers` / `Request` / `Response` | Node 18+, Bun, Deno, Browsers |

**Best practice:** When writing cross-runtime code, prefer Web APIs over runtime-specific ones.

---

## Choosing the Right Runtime

| Scenario | Recommendation |
|----------|---------------|
| Production API server | **Node.js** (most mature, largest ecosystem) |
| Quick scripts / CLI tools | **Bun** (fastest startup, runs TS natively) |
| Security-sensitive server | **Deno** (permission system) |
| Edge/serverless functions | **Deno Deploy** or **Cloudflare Workers** |
| Frontend build tooling | **Bun** (fast bundler + package install) |
| Enterprise / existing codebase | **Node.js** (stability, LTS, ecosystem) |
| New project, small team, TS-first | **Bun** (simple, fast, TS native) |
| Learning / experimentation | Any — but Bun/Deno have better DX out of box |
