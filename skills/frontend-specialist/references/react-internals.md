# React Internals Reference

## Table of Contents

1. [Fiber Architecture](#fiber-architecture)
2. [Reconciliation Algorithm](#reconciliation-algorithm)
3. [Hooks Internals](#hooks-internals)
4. [Rendering Pipeline](#rendering-pipeline)
5. [React Server Components](#react-server-components)
6. [Concurrent Features](#concurrent-features)
7. [Performance Optimization](#performance-optimization)

---

## Fiber Architecture

### What is Fiber?
Fiber is React's internal representation of a component instance. Each React element becomes a Fiber node in a tree structure. Fiber enables incremental rendering — work can be paused, aborted, or resumed.

### Fiber Node Structure (Simplified)
```
FiberNode {
  tag: number           // Component type (FunctionComponent, HostComponent, etc.)
  type: Function|string // The component function or HTML tag
  stateNode: any        // DOM node (for host components) or class instance
  child: Fiber          // First child
  sibling: Fiber        // Next sibling
  return: Fiber         // Parent
  memoizedState: any    // Hooks linked list (for function components)
  memoizedProps: any    // Props from last render
  pendingProps: any     // Props for next render
  flags: number         // Side effects (Placement, Update, Deletion)
  lanes: number         // Priority of pending work
}
```

### Double Buffering
React maintains two Fiber trees:
- **Current tree**: What's on screen
- **Work-in-progress (WIP) tree**: Being built during render

On commit, the WIP tree becomes the current tree (pointer swap).

---

## Reconciliation Algorithm

### Diffing Heuristics
React uses O(n) heuristics instead of O(n³) tree diff:

1. **Different element types** → Tear down old tree, build new one
2. **Same element type** → Update attributes, recurse on children
3. **Keys** → Match children across re-renders for lists

### Key Rules
```jsx
// BAD: No keys — React uses index (breaks on reorder, insert, delete)
{items.map(item => <Item data={item} />)}

// BAD: Index as key — same problem as no key for dynamic lists
{items.map((item, i) => <Item key={i} data={item} />)}

// GOOD: Stable unique ID
{items.map(item => <Item key={item.id} data={item} />)}
```

**When index keys are OK:** Static lists that never reorder, filter, or insert.

### Bailout Conditions (When React Skips Re-render)
1. `oldProps === newProps` (referential equality) AND no pending state/context updates
2. `React.memo()` with shallow prop comparison (or custom comparator)
3. `useMemo`/`useCallback` preventing new references
4. Component returns exact same JSX reference

---

## Hooks Internals

### How Hooks Work
Hooks are stored as a linked list on the Fiber's `memoizedState`. Each hook call corresponds to a node in the list. This is why hooks must be called in the same order every render.

```
Fiber.memoizedState → Hook1 → Hook2 → Hook3 → null
                      (useState) (useEffect) (useMemo)
```

### useState Internals
```javascript
// Simplified: useState uses a queue of updates
hook.memoizedState = initialState;
hook.queue = { pending: null }; // Circular linked list of updates

// dispatch enqueues an update and schedules re-render
function dispatch(action) {
  const update = { action, next: null };
  // Add to circular queue
  enqueueUpdate(hook.queue, update);
  scheduleUpdateOnFiber(fiber);
}
```

**Batching:** React 18+ automatically batches all state updates (including setTimeout, promises, event handlers). Multiple `setState` calls in the same synchronous block = one re-render.

### useEffect Internals
- Effects run **after** paint (asynchronous) — doesn't block rendering
- `useLayoutEffect` runs **before** paint (synchronous) — blocks rendering
- Cleanup runs before the next effect and on unmount
- Dependency comparison uses `Object.is` (referential equality)

### Rules of Hooks (Why They Exist)
- **Only call at top level** → Linked list relies on call order
- **Only call in React functions** → Need access to current Fiber
- **No conditional hooks** → Would break the linked list mapping

---

## Rendering Pipeline

### Phases

```
Trigger → Render → Commit
```

1. **Trigger**: State change, prop change, context change, or forceUpdate
2. **Render Phase** (pure, no side effects, can be interrupted):
   - Build/update Fiber tree (work-in-progress)
   - Call component functions, compute new JSX
   - Diff old vs new (reconciliation)
   - Mark Fibers with effect flags
3. **Commit Phase** (synchronous, cannot be interrupted):
   - Apply DOM mutations
   - Run `useLayoutEffect` callbacks
   - Schedule `useEffect` callbacks (run async after paint)

### What Causes Re-renders

| Trigger | Re-renders |
|---------|-----------|
| `setState` with new value | The component + all children |
| Parent re-renders | All children (unless memoized) |
| Context value changes | All consumers of that context |
| Custom hook state changes | The component using the hook |
| `forceUpdate` | The component + all children |

### What Does NOT Cause Re-renders
- Ref changes (`useRef`)
- Direct DOM manipulation
- Variables outside React state

---

## React Server Components

### Mental Model
```
Server Components (SC):
  - Run on server only
  - Can access DB, file system, secrets
  - Cannot use hooks, event handlers, browser APIs
  - Zero JS sent to client
  - Can import Client Components

Client Components (CC):
  - Run on client (and server for SSR)
  - Can use hooks, state, effects, event handlers
  - Bundle shipped to client
  - Cannot import Server Components (but can receive them as children)
```

### The Boundary Pattern
```jsx
// ServerComponent.tsx (no 'use client' directive)
import { ClientButton } from './ClientButton';

export default async function Page() {
  const data = await db.query('SELECT * FROM posts'); // Server-only
  return (
    <div>
      <h1>{data.title}</h1>
      <ClientButton onClick="like"> {/* Client interactivity */}
        <ServerContent /> {/* SC passed as children to CC */}
      </ClientButton>
    </div>
  );
}

// ClientButton.tsx
'use client';
export function ClientButton({ children, onClick }) {
  const [liked, setLiked] = useState(false);
  return <button onClick={() => setLiked(true)}>{children}</button>;
}
```

### Serialization Boundary
Props passed from SC to CC must be serializable (no functions, classes, Dates → use ISO strings).

---

## Concurrent Features

### Transitions (`useTransition`, `startTransition`)
Mark state updates as non-urgent. React can interrupt to handle urgent updates (typing, clicking).

```jsx
const [isPending, startTransition] = useTransition();

function handleSearch(query) {
  // Urgent: update input immediately
  setInputValue(query);

  // Non-urgent: can be interrupted
  startTransition(() => {
    setSearchResults(filterResults(query));
  });
}
```

### Suspense
Declarative loading states. Works with lazy components, data fetching (via frameworks), and server components.

```jsx
<Suspense fallback={<Skeleton />}>
  <AsyncComponent /> {/* Suspends until ready */}
</Suspense>
```

### useDeferredValue
Returns a deferred version of a value. Useful for expensive re-renders based on fast-changing input.

```jsx
const deferredQuery = useDeferredValue(query);
// deferredQuery lags behind query during rapid typing
// Expensive list re-render uses deferred value
```

---

## Performance Optimization

### Preventing Unnecessary Re-renders

| Technique | When to Use |
|-----------|------------|
| `React.memo(Component)` | Component re-renders with same props frequently |
| `useMemo(computation, deps)` | Expensive computation, derived state |
| `useCallback(fn, deps)` | Stable function reference for memoized children |
| Composition (children pattern) | Move state down, push content up |
| Context splitting | Separate frequently-changing from rarely-changing values |

### Composition Over Memo (Preferred)

```jsx
// BAD: Memoizing everything
const MemoChild = React.memo(ExpensiveChild);
function Parent() {
  const [count, setCount] = useState(0);
  return <><Counter count={count} /><MemoChild /></>;
}

// BETTER: Move state down — ExpensiveChild never re-renders
function Parent() {
  return <><CounterWithState /><ExpensiveChild /></>;
}

// BETTER: Push content up as children
function Parent({ children }) {
  const [count, setCount] = useState(0);
  return <><Counter count={count} />{children}</>;
}
// Usage: <Parent><ExpensiveChild /></Parent>
```

### Virtualization
For lists > 50 items, use windowing:
- `@tanstack/react-virtual` (recommended)
- `react-window` (lighter)
- `react-virtuoso` (more features)

### Code Splitting
```jsx
// Route-level (automatic in Next.js)
const Dashboard = lazy(() => import('./Dashboard'));

// Component-level
const HeavyChart = lazy(() => import('./HeavyChart'));
<Suspense fallback={<Skeleton />}>
  <HeavyChart />
</Suspense>
```

### Profiling Tools
- React DevTools Profiler (flamegraph of renders)
- `<Profiler>` component for programmatic measurement
- `why-did-you-render` library for debugging unnecessary renders
- Chrome DevTools Performance tab for runtime analysis
