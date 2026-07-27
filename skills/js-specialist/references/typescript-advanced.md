# Advanced TypeScript Reference

## Table of Contents

1. [Type System Fundamentals](#type-system-fundamentals)
2. [Generics Mastery](#generics-mastery)
3. [Conditional Types](#conditional-types)
4. [Mapped Types](#mapped-types)
5. [Template Literal Types](#template-literal-types)
6. [Type Guards & Narrowing](#type-guards--narrowing)
7. [Utility Type Patterns](#utility-type-patterns)
8. [Declaration Merging & Module Augmentation](#declaration-merging--module-augmentation)
9. [Strict Mode Pitfalls](#strict-mode-pitfalls)

---

## Type System Fundamentals

### Structural Typing (Duck Typing)
TypeScript uses structural typing — two types are compatible if their structures match, regardless of name.

```typescript
interface Point { x: number; y: number }
interface Coordinate { x: number; y: number }
// Point and Coordinate are interchangeable — same structure

const p: Point = { x: 1, y: 2 };
const c: Coordinate = p; // OK — structural match
```

**Gotcha:** Excess property checking only applies to object literals:
```typescript
const obj = { x: 1, y: 2, z: 3 };
const p: Point = obj; // OK — extra properties allowed via variable
const p2: Point = { x: 1, y: 2, z: 3 }; // ERROR — excess property on literal
```

### Discriminated Unions (The Most Important Pattern)
Use a literal type field to distinguish union members. TypeScript narrows automatically.

```typescript
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: Error };

function handle<T>(result: Result<T>) {
  if (result.ok) {
    result.value; // T — narrowed
  } else {
    result.error; // Error — narrowed
  }
}
```

**Rules:**
- Discriminant must be a literal type (string, number, boolean)
- Every union member must have the discriminant field
- Prefer discriminated unions over `instanceof` checks

### `unknown` vs `any`
- `any`: Disables type checking entirely. Avoid.
- `unknown`: Type-safe top type. Must narrow before use.

```typescript
function process(input: unknown) {
  // input.foo — ERROR: must narrow first
  if (typeof input === 'string') {
    input.toUpperCase(); // OK — narrowed to string
  }
  if (input instanceof Error) {
    input.message; // OK — narrowed to Error
  }
}
```

### `never` Type
Represents values that never occur. Use for exhaustive checks.

```typescript
type Shape = 'circle' | 'square' | 'triangle';

function area(shape: Shape): number {
  switch (shape) {
    case 'circle': return /*...*/;
    case 'square': return /*...*/;
    case 'triangle': return /*...*/;
    default:
      const _exhaustive: never = shape; // Compile error if a case is missed
      throw new Error(`Unhandled: ${_exhaustive}`);
  }
}
```

---

## Generics Mastery

### Constraint Patterns

```typescript
// Basic constraint
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}

// Multiple constraints with intersection
function merge<T extends object, U extends object>(a: T, b: U): T & U {
  return { ...a, ...b };
}

// Constraint with conditional default
function createStore<T extends Record<string, unknown> = Record<string, never>>() {
  // ...
}
```

### Inference Patterns

```typescript
// Infer function return type
type ReturnOf<T> = T extends (...args: any[]) => infer R ? R : never;

// Infer array element type
type ElementOf<T> = T extends (infer E)[] ? E : never;

// Infer promise resolved type
type Awaited<T> = T extends Promise<infer R> ? Awaited<R> : T;

// Infer from specific position
type FirstArg<T> = T extends (first: infer F, ...rest: any[]) => any ? F : never;
```

### Generic Constraints Best Practices
- Only add generics when the type truly varies between call sites
- Use `extends` to constrain, don't over-constrain
- Prefer fewer type parameters — each adds cognitive load
- Use defaults (`= Type`) for optional type parameters
- Name generics meaningfully for complex signatures: `TData`, `TError`, not just `T`, `U`

---

## Conditional Types

### Basic Pattern
```typescript
type IsString<T> = T extends string ? true : false;
type A = IsString<'hello'>; // true
type B = IsString<42>;      // false
```

### Distributive Conditional Types
Conditional types distribute over unions automatically:
```typescript
type ToArray<T> = T extends any ? T[] : never;
type Result = ToArray<string | number>; // string[] | number[]

// Prevent distribution with tuple wrapper:
type ToArrayNonDist<T> = [T] extends [any] ? T[] : never;
type Result2 = ToArrayNonDist<string | number>; // (string | number)[]
```

### Practical Conditional Types

```typescript
// Extract specific types from a union
type ExtractStrings<T> = T extends string ? T : never;
type Names = ExtractStrings<'alice' | 42 | 'bob' | true>; // 'alice' | 'bob'

// Make properties optional based on condition
type OptionalIf<T, Condition extends boolean> =
  Condition extends true ? Partial<T> : T;

// Deep readonly
type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;
```

---

## Mapped Types

### Core Pattern
```typescript
type Readonly<T> = { readonly [K in keyof T]: T[K] };
type Optional<T> = { [K in keyof T]?: T[K] };
type Nullable<T> = { [K in keyof T]: T[K] | null };
```

### Key Remapping (as clause)
```typescript
// Prefix all keys
type Prefixed<T, P extends string> = {
  [K in keyof T as `${P}${Capitalize<string & K>}`]: T[K]
};

type User = { name: string; age: number };
type PrefixedUser = Prefixed<User, 'get'>;
// { getName: string; getAge: number }

// Filter keys by value type
type StringKeys<T> = {
  [K in keyof T as T[K] extends string ? K : never]: T[K]
};
```

### Practical Mapped Types

```typescript
// Event handler map from interface
type EventHandlers<T> = {
  [K in keyof T as `on${Capitalize<string & K>}Change`]: (value: T[K]) => void;
};

type FormState = { name: string; email: string; age: number };
type FormHandlers = EventHandlers<FormState>;
// { onNameChange: (value: string) => void; onEmailChange: ... }

// Make specific keys required
type RequireKeys<T, K extends keyof T> = T & Required<Pick<T, K>>;
```

---

## Template Literal Types

```typescript
// Type-safe event names
type EventName = `${'click' | 'focus' | 'blur'}${'' | 'Capture'}`;
// 'click' | 'clickCapture' | 'focus' | 'focusCapture' | 'blur' | 'blurCapture'

// Type-safe CSS values
type CSSUnit = `${number}${'px' | 'rem' | 'em' | '%' | 'vh' | 'vw'}`;
const width: CSSUnit = '100px'; // OK
const bad: CSSUnit = '100ft';   // ERROR

// Route parameter extraction
type ExtractParams<T extends string> =
  T extends `${string}:${infer Param}/${infer Rest}`
    ? Param | ExtractParams<Rest>
    : T extends `${string}:${infer Param}`
      ? Param
      : never;

type Params = ExtractParams<'/users/:userId/posts/:postId'>; // 'userId' | 'postId'
```

---

## Type Guards & Narrowing

### Custom Type Guards
```typescript
// Type predicate
function isString(value: unknown): value is string {
  return typeof value === 'string';
}

// Assertion function (throws if false)
function assertDefined<T>(value: T | null | undefined): asserts value is T {
  if (value == null) throw new Error('Value is null or undefined');
}

// Discriminated union guard
function isSuccess<T>(result: Result<T>): result is { ok: true; value: T } {
  return result.ok;
}
```

### Narrowing Techniques (Preferred Order)
1. **Discriminated unions** — Best: compiler narrows automatically
2. **`typeof` checks** — For primitives: `string`, `number`, `boolean`, etc.
3. **`in` operator** — For checking property existence: `'name' in obj`
4. **`instanceof`** — For class instances (doesn't work across realms)
5. **Custom type guards** — When none of the above suffice

---

## Utility Type Patterns

### Building Type-Safe APIs

```typescript
// Strict omit (errors on non-existent keys)
type StrictOmit<T, K extends keyof T> = Omit<T, K>;

// Deep partial (recursive)
type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;

// Require at least one key from a set
type RequireAtLeastOne<T, Keys extends keyof T = keyof T> =
  Pick<T, Exclude<keyof T, Keys>> &
  { [K in Keys]-?: Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>> }[Keys];

// XOR — exactly one of two types
type XOR<T, U> =
  | (T & { [K in Exclude<keyof U, keyof T>]?: never })
  | (U & { [K in Exclude<keyof T, keyof U>]?: never });

// Usage: API must have either `id` or `slug`, not both
type Query = XOR<{ id: number }, { slug: string }>;
```

### Branded/Opaque Types

```typescript
type Brand<T, B> = T & { __brand: B };
type UserId = Brand<string, 'UserId'>;
type OrderId = Brand<string, 'OrderId'>;

function getUser(id: UserId) { /* ... */ }

const userId = 'abc' as UserId;
const orderId = 'xyz' as OrderId;
getUser(userId);  // OK
getUser(orderId); // ERROR — OrderId is not assignable to UserId
```

---

## Declaration Merging & Module Augmentation

```typescript
// Extend third-party types
declare module 'express' {
  interface Request {
    user?: { id: string; role: string };
  }
}

// Extend global types
declare global {
  interface Window {
    analytics: AnalyticsClient;
  }
}

// Extend environment variables
declare namespace NodeJS {
  interface ProcessEnv {
    DATABASE_URL: string;
    NODE_ENV: 'development' | 'production' | 'test';
  }
}
```

---

## Strict Mode Pitfalls

### `strictNullChecks` — Always Enable
```typescript
// Without: string includes null/undefined silently — bugs
// With: must handle null explicitly
function getLength(s: string | null): number {
  if (s === null) return 0; // Must handle
  return s.length;
}
```

### `noUncheckedIndexedAccess` — Recommended
```typescript
const arr = [1, 2, 3];
const val = arr[5]; // Type: number | undefined (not number)
// Forces you to handle the undefined case
```

### `exactOptionalPropertyTypes` — Recommended
```typescript
interface Config { debug?: boolean }
// Without: { debug: undefined } is allowed
// With: { debug: undefined } is NOT allowed — must omit the key entirely
```

### Recommended tsconfig.json Strict Settings
```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true
  }
}
```
