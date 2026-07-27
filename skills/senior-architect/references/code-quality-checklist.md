# Code Quality Checklist

## Table of Contents

1. [Code Review Criteria](#code-review-criteria)
2. [Common Anti-Patterns](#common-anti-patterns)
3. [Refactoring Signals](#refactoring-signals)
4. [TypeScript Best Practices](#typescript-best-practices)
5. [React/Next.js Quality Gates](#reactnextjs-quality-gates)

---

## Code Review Criteria

### Correctness
- Does the code do what it's supposed to?
- Are edge cases handled (null, empty, boundary values)?
- Are error states handled gracefully?
- Are race conditions possible (concurrent requests, state updates)?

### Clarity
- Can a new developer understand this in under 2 minutes?
- Are names descriptive and consistent with codebase conventions?
- Is complexity justified or can it be simplified?
- Are magic numbers/strings extracted as named constants?

### Maintainability
- Does changing one behavior require touching many files?
- Are dependencies explicit (no hidden global state)?
- Is the code testable without mocking the world?
- Does it follow existing project patterns and conventions?

### Performance
- Are there N+1 queries or unnecessary re-renders?
- Are expensive operations memoized or cached where appropriate?
- Is data fetching happening at the right level (server vs. client)?
- Are bundle size implications considered (large imports)?

---

## Common Anti-Patterns

### God Component / God Module
**Signal:** A single file over 300 lines handling multiple concerns.
**Fix:** Extract into focused components/modules. Apply SRP.

### Prop Drilling
**Signal:** Props passed through 3+ levels of components.
**Fix:** Use React Context, Zustand, or composition pattern (children/render props).

### Premature Abstraction
**Signal:** A "reusable" utility used exactly once, or an abstraction layer that just forwards calls.
**Fix:** Wait for the third use before abstracting. Delete unnecessary indirection.

### Leaky Abstraction
**Signal:** Consumers need to know internal implementation details to use the API correctly.
**Fix:** Redesign the interface to hide implementation. Use the "pit of success" principle.

### State Synchronization
**Signal:** Multiple state variables that must stay in sync (derived state stored separately).
**Fix:** Derive state during render. Use `useMemo` if computation is expensive.

```typescript
// BAD: synchronized state
const [items, setItems] = useState([]);
const [count, setCount] = useState(0); // must sync with items.length

// GOOD: derived state
const [items, setItems] = useState([]);
const count = items.length;
```

### Barrel File Bloat
**Signal:** Index files that re-export everything, defeating tree-shaking.
**Fix:** Import directly from the source module for internal code. Use barrels only for public API boundaries.

### Copy-Paste-Modify
**Signal:** 3+ similar code blocks with minor variations.
**Fix:** Extract a parameterized function, component, or configuration-driven approach.

### Callback Hell / Promise Chain Spaghetti
**Signal:** Deeply nested callbacks or long `.then()` chains.
**Fix:** Use async/await. Extract named functions for complex steps.

### Inconsistent Error Handling
**Signal:** Some errors are caught, some thrown, some silently swallowed. Mix of try/catch, .catch(), and unchecked promises.
**Fix:** Establish a consistent error handling strategy. Use error boundaries in React. Create typed error classes for business errors.

---

## Refactoring Signals

### When to Refactor

| Signal | Action |
|--------|--------|
| Adding a feature requires modifying 5+ files | Extract shared abstraction |
| Same bug pattern keeps recurring | Add type safety or validation at the source |
| New team members consistently misunderstand a module | Simplify or document the module |
| Tests require excessive mocking | Reduce coupling, inject dependencies |
| Build/compile time is noticeably slow | Split modules, lazy load |

### When NOT to Refactor
- Code works, is tested, and nobody needs to modify it
- Refactoring won't reduce future maintenance burden
- The refactor is purely aesthetic with no functional benefit
- You're in the middle of a deadline-critical feature

---

## TypeScript Best Practices

### Type Safety
- Avoid `any` — use `unknown` and narrow with type guards
- Use discriminated unions for state variants
- Prefer `interface` for object shapes, `type` for unions/intersections
- Use `as const` for literal tuples and objects
- Leverage template literal types for string patterns

```typescript
// Discriminated union for API states
type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: Error };
```

### Avoid Pitfalls
- Don't use `enum` — prefer union types or `as const` objects
- Don't overuse generics — only when the type truly varies
- Don't use `!` (non-null assertion) — handle the null case
- Don't create `I`-prefixed interfaces (e.g., `IUser`) — just `User`

### Utility Types
- `Partial<T>` — all properties optional (good for update operations)
- `Required<T>` — all properties required
- `Pick<T, K>` — subset of properties
- `Omit<T, K>` — exclude properties
- `Record<K, V>` — typed key-value maps
- `Extract/Exclude` — filter union types

---

## React/Next.js Quality Gates

### Component Design
- Components under 150 lines (extract if longer)
- Props interface defined and typed (no `any` props)
- Side effects in hooks, not in render body
- Loading and error states handled
- Accessible (semantic HTML, ARIA labels, keyboard navigation)

### Hook Design
- Custom hooks start with `use`
- Single responsibility per hook
- Return stable references (useCallback/useMemo where needed)
- Handle cleanup in useEffect return

### Server vs. Client Component Decision
Use **Server Component** when:
- Fetching data
- Accessing backend resources directly
- Keeping sensitive info on server (tokens, keys)
- No interactivity needed

Use **Client Component** (`'use client'`) when:
- Using useState, useEffect, or other React hooks
- Event listeners needed (onClick, onChange)
- Browser-only APIs needed (localStorage, window)
- Using third-party client-side libraries

### Performance Gates
- No unnecessary `'use client'` — keep client boundary as low as possible
- No fetching in useEffect when server component or React Query is available
- Images use `next/image` with explicit width/height
- Lists over 50 items use virtualization
- Heavy computations wrapped in useMemo/useCallback with correct deps
