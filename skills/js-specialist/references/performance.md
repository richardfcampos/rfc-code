# JavaScript/Node.js Performance Reference

## Table of Contents

1. [Profiling & Measurement](#profiling--measurement)
2. [V8 Optimization Patterns](#v8-optimization-patterns)
3. [Memory Optimization](#memory-optimization)
4. [Async Performance](#async-performance)
5. [Data Structure Performance](#data-structure-performance)
6. [Node.js Server Performance](#nodejs-server-performance)
7. [Browser Performance](#browser-performance)
8. [Bundle Optimization](#bundle-optimization)

---

## Profiling & Measurement

### Rule: Always Measure First
Never optimize without profiling. Intuition about bottlenecks is wrong most of the time.

### Node.js Profiling Tools

| Tool | Use For | Command |
|------|---------|---------|
| Built-in profiler | CPU profiling | `node --prof app.js` then `node --prof-process` |
| Chrome DevTools | CPU + memory + heap | `node --inspect app.js` |
| `perf_hooks` | Precise timing | `performance.now()`, `PerformanceObserver` |
| `clinic.js` | Automated profiling | `clinic doctor -- node app.js` |
| `0x` | Flame graphs | `0x app.js` |

### Benchmarking

```javascript
// Use performance.now() for precise timing
const { performance } = require('perf_hooks');

const start = performance.now();
// ... operation ...
const end = performance.now();
console.log(`Took ${end - start}ms`);

// For microbenchmarks, run many iterations
function bench(fn, iterations = 1_000_000) {
  // Warm up (allow JIT optimization)
  for (let i = 0; i < 1000; i++) fn();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = performance.now() - start;

  console.log(`${elapsed.toFixed(2)}ms total, ${(elapsed / iterations * 1000).toFixed(2)}µs/op`);
}
```

**Benchmarking pitfalls:**
- Dead code elimination: V8 may skip code whose result isn't used
- JIT warm-up: First runs are slower (interpreter mode)
- GC pauses: Run many iterations to amortize
- Microbenchmarks lie: Synthetic tests don't reflect real workloads

---

## V8 Optimization Patterns

### Monomorphic vs Polymorphic Code

```javascript
// FAST: Monomorphic — always called with same types
function add(a, b) { return a + b; }
add(1, 2);   // number + number
add(3, 4);   // number + number — V8 optimizes for number

// SLOW: Polymorphic — called with different types
add(1, 2);       // number + number
add('a', 'b');   // string + string — V8 must handle both
```

### Object Shape Consistency

```javascript
// FAST: Same shape every time
class Point {
  constructor(x, y) {
    this.x = x; // Always initialized
    this.y = y; // Always initialized
  }
}

// SLOW: Variable shape
function makePoint(x, y, z) {
  const p = { x, y };
  if (z !== undefined) p.z = z; // Sometimes has z, sometimes not
  return p;
}
```

### Hot Loop Optimization

```javascript
// FAST: Simple loop, monomorphic array access
const arr = new Float64Array(1000);
let sum = 0;
for (let i = 0; i < arr.length; i++) {
  sum += arr[i];
}

// SLOW: Polymorphic, hidden deopt triggers
const mixed = [1, 'two', { three: 3 }]; // Polymorphic array
for (const item of mixed) {
  // V8 can't optimize — different types on each iteration
}
```

### Avoid Deoptimization

| Pattern | Problem | Fix |
|---------|---------|-----|
| `delete obj.prop` | Changes hidden class | `obj.prop = undefined` |
| Sparse arrays (`arr[1000] = 1`) | Switches to dictionary mode | Pre-allocate or use Map |
| `arguments` object | Prevents optimization | Use rest params `...args` |
| Changing variable types | Breaks type specialization | Keep types consistent |
| `try/catch` around hot code | Limits optimization scope | Minimize try block size |

---

## Memory Optimization

### Reduce Allocations

```javascript
// BAD: Allocates new array every call
function getCoords(points) {
  return points.map(p => [p.x, p.y]); // New array for each point
}

// BETTER: Reuse pre-allocated buffer
const buffer = new Float64Array(2000); // Pre-allocate
function getCoordsInto(points, out) {
  for (let i = 0; i < points.length; i++) {
    out[i * 2] = points[i].x;
    out[i * 2 + 1] = points[i].y;
  }
}
```

### TypedArrays for Numeric Data
```javascript
// Regular array: each number boxed as heap object (~16-32 bytes)
const regular = [1.0, 2.0, 3.0]; // 3 * ~32 bytes = ~96 bytes

// TypedArray: raw binary data, no boxing (~8 bytes per float64)
const typed = new Float64Array([1.0, 2.0, 3.0]); // 3 * 8 = 24 bytes
```

### WeakRef and FinalizationRegistry
```javascript
// Cache that doesn't prevent GC
const cache = new Map();

function getCached(key, computeFn) {
  const ref = cache.get(key);
  if (ref) {
    const value = ref.deref();
    if (value !== undefined) return value;
  }
  const value = computeFn();
  cache.set(key, new WeakRef(value));
  return value;
}
```

### String Optimization
- Strings are immutable — concatenation creates new strings
- Use template literals or `Array.join()` for building large strings
- `Buffer` for binary data, not strings
- `String.prototype.slice()` creates a "sliced string" (references original — memory efficient)

---

## Async Performance

### Promise vs Callback Performance
Promises have ~2-5x overhead vs raw callbacks due to microtask scheduling and object allocation. For hot paths processing millions of items, callbacks or streams may be faster.

### Parallelism Patterns

```javascript
// Sequential — SLOW for independent operations
for (const url of urls) {
  const data = await fetch(url);
  results.push(data);
}

// Parallel — FAST but may overwhelm target
const results = await Promise.all(urls.map(url => fetch(url)));

// Controlled concurrency — BEST for most cases
async function mapWithConcurrency(items, fn, concurrency = 5) {
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}
```

### `Promise.allSettled` vs `Promise.all`
- `Promise.all`: Rejects on first failure (fast-fail)
- `Promise.allSettled`: Waits for all, reports individual results
- Use `allSettled` when partial success is acceptable

### AbortController for Cancellation
```javascript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 5000);

try {
  const response = await fetch(url, { signal: controller.signal });
  clearTimeout(timeout);
} catch (err) {
  if (err.name === 'AbortError') { /* Timeout or manual cancel */ }
}
```

---

## Data Structure Performance

### Big-O Quick Reference

| Operation | Array | Map | Set | Object |
|-----------|-------|-----|-----|--------|
| Access by index/key | O(1) | O(1) | — | O(1) |
| Search (has value) | O(n) | O(1) by key | O(1) | O(1) by key |
| Insert | O(1) push, O(n) unshift | O(1) | O(1) | O(1) |
| Delete | O(n) splice, O(1) pop | O(1) | O(1) | O(1) but slow |
| Iteration | O(n) | O(n) ordered | O(n) ordered | O(n) unordered |

### When to Use What

| Need | Use | Why |
|------|-----|-----|
| Ordered list, index access | `Array` | Cache-friendly, fast iteration |
| Key-value with non-string keys | `Map` | Any key type, O(1) ops, preserves insertion order |
| Key-value with string keys | `Object` or `Map` | Object for <100 keys, Map for frequent add/delete |
| Unique value collection | `Set` | O(1) has/add/delete |
| Frequent adds/deletes from both ends | `Array` + manual offset or linked list | `unshift` is O(n) |
| Sorted data + frequent lookups | Sorted array + binary search | O(log n) search |
| Weak references to object keys | `WeakMap` / `WeakSet` | Allows GC of keys |

### Array Method Performance

```javascript
// SLOW: Creates new array each time
const result = arr.filter(x => x > 0).map(x => x * 2); // Two passes, two allocations

// FASTER: Single pass with reduce
const result = arr.reduce((acc, x) => {
  if (x > 0) acc.push(x * 2);
  return acc;
}, []);

// FASTEST: Simple for loop (no closures, no method overhead)
const result = [];
for (let i = 0; i < arr.length; i++) {
  if (arr[i] > 0) result.push(arr[i] * 2);
}
```

---

## Node.js Server Performance

### HTTP Server Optimization
- Use `keep-alive` connections (default in HTTP/1.1)
- Enable response compression (but not for already-compressed content like images)
- Use `cluster` or process manager (PM2) to use all CPU cores
- Stream responses instead of buffering
- Set appropriate `Content-Length` or use chunked encoding

### Database Query Optimization
- Connection pooling (don't create/destroy per request)
- Batch related queries with `Promise.all`
- Use prepared statements (query plan caching)
- Select only needed columns
- Use indexes for WHERE/JOIN/ORDER BY columns
- Implement application-level caching (Redis, in-memory)

### JSON Performance
```javascript
// JSON.parse is fast for >10KB — faster than JS object literal evaluation
// For very large JSON, consider streaming parsers

// Faster serialization for simple objects
const fastStringify = (obj) => `{"name":"${obj.name}","age":${obj.age}}`;
// Only use for hot paths with known shapes — fragile

// JSON.parse reviver is slow — avoid for large payloads
// Better: parse then transform
```

---

## Browser Performance

### Rendering Pipeline
```
JavaScript → Style → Layout → Paint → Composite
```

- **Avoid layout thrashing**: Don't read then write DOM properties in a loop
- **Use `requestAnimationFrame`** for visual updates
- **Prefer `transform` and `opacity`** for animations (compositor-only, skip layout/paint)
- **Use `will-change`** sparingly to hint compositor layer promotion
- **`IntersectionObserver`** for lazy loading (not scroll listeners)

### DOM Optimization
- Batch DOM mutations (DocumentFragment or innerHTML for bulk)
- Use event delegation (single listener on parent, not per child)
- `requestIdleCallback` for non-critical work
- Avoid forced synchronous layouts (reading `offsetHeight` after style change)

---

## Bundle Optimization

### Tree-Shaking Requirements
- Use ESM (`import`/`export`) — CommonJS is not tree-shakeable
- Set `"sideEffects": false` in package.json (or list side-effect files)
- Avoid barrel files that re-export everything
- Import specific functions: `import { debounce } from 'lodash-es'` not `import _ from 'lodash'`

### Code Splitting
```javascript
// Route-level splitting (Next.js does this automatically)
const HeavyComponent = dynamic(() => import('./HeavyComponent'));

// Manual splitting
const { processData } = await import('./heavy-processor');
```

### Package Size Awareness

| Package | Size (min+gzip) | Lighter Alternative |
|---------|-----------------|---------------------|
| `moment` | 72KB | `date-fns` (tree-shakeable), `dayjs` (2KB) |
| `lodash` | 72KB | `lodash-es` (tree-shakeable), native methods |
| `axios` | 13KB | `fetch` (native), `ky` (3KB) |
| `uuid` | 3KB | `crypto.randomUUID()` (native) |
| `chalk` | 6KB | Node built-in `util.styleText` (Node 21+) |

**Rule:** Before adding a dependency, check if a native API covers the use case. Node.js and browsers have added many built-in APIs that replace popular packages.
