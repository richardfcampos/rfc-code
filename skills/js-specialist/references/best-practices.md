# JavaScript/Node.js Best Practices

## Table of Contents

1. [Error Handling](#error-handling)
2. [Async Patterns](#async-patterns)
3. [Module Design](#module-design)
4. [Testing Patterns](#testing-patterns)
5. [Security](#security)
6. [Code Quality Patterns](#code-quality-patterns)

---

## Error Handling

### Error Classification

| Type | Description | How to Handle |
|------|------------|---------------|
| **Operational** | Expected runtime failures (network timeout, invalid input, file not found) | Handle gracefully, retry or inform user |
| **Programmer** | Bugs (TypeError, null reference, wrong argument type) | Fix the code, don't catch these in production |
| **System** | OS/infra failures (out of memory, disk full) | Log, alert, crash gracefully |

### Custom Error Classes

```typescript
class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly isOperational: boolean = true
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} with id ${id} not found`, 'NOT_FOUND', 404);
  }
}

class ValidationError extends AppError {
  constructor(message: string, public readonly fields: Record<string, string>) {
    super(message, 'VALIDATION_ERROR', 400);
  }
}
```

### Async Error Handling Patterns

```typescript
// GOOD: Centralized error handler for Express/Fastify
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof AppError && err.isOperational) {
    res.status(err.statusCode).json({ error: { code: err.code, message: err.message } });
  } else {
    // Programmer error — log and return generic message
    logger.error('Unexpected error', err);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  }
});

// GOOD: Promise rejection handler (safety net)
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', reason);
  // In production: crash gracefully — unhandled rejections indicate bugs
  process.exit(1);
});
```

### Error Handling Rules
- **Never swallow errors silently** — at minimum, log them
- **Don't use try/catch for flow control** — use conditional checks
- **Catch at the boundary** — API routes, event handlers, not deep in business logic
- **Include context** — error messages should say what happened and what was being attempted
- **Fail fast** — validate input at entry points, throw early
- **Never throw inside a `.then()` without a `.catch()`** — use async/await instead

---

## Async Patterns

### async/await Best Practices

```typescript
// GOOD: Parallel independent operations
const [users, posts] = await Promise.all([
  getUsers(),
  getPosts(),
]);

// BAD: Sequential when parallel is possible
const users = await getUsers();
const posts = await getPosts(); // Waits for users unnecessarily

// GOOD: Error handling with context
async function processOrder(orderId: string) {
  const order = await getOrder(orderId);
  if (!order) throw new NotFoundError('Order', orderId);

  try {
    await chargePayment(order);
  } catch (err) {
    throw new AppError(`Payment failed for order ${orderId}: ${err.message}`, 'PAYMENT_FAILED', 402);
  }

  await fulfillOrder(order);
}
```

### Retry Pattern

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; delay?: number; backoff?: number } = {}
): Promise<T> {
  const { maxRetries = 3, delay = 1000, backoff = 2 } = options;
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, delay * backoff ** attempt));
      }
    }
  }
  throw lastError!;
}
```

### Async Iteration

```typescript
// Process stream of data
async function* readLines(filePath: string) {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
  });
  for await (const line of rl) {
    yield line;
  }
}

// Consume async generator
for await (const line of readLines('data.csv')) {
  await processLine(line);
}
```

### Cancellation with AbortSignal

```typescript
async function fetchWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
```

---

## Module Design

### Module Patterns

```typescript
// GOOD: Single responsibility, clear exports
// user.service.ts
export function createUser(data: CreateUserInput): Promise<User> { /* ... */ }
export function getUserById(id: string): Promise<User | null> { /* ... */ }
export function updateUser(id: string, data: UpdateUserInput): Promise<User> { /* ... */ }

// BAD: God module with mixed concerns
export function createUser() { /* ... */ }
export function sendEmail() { /* ... */ }
export function formatDate() { /* ... */ }
export function validateInput() { /* ... */ }
```

### Dependency Injection (Without Frameworks)

```typescript
// Define interface
interface UserRepository {
  findById(id: string): Promise<User | null>;
  save(user: User): Promise<void>;
}

// Service depends on abstraction
function createUserService(repo: UserRepository) {
  return {
    async getUser(id: string) {
      const user = await repo.findById(id);
      if (!user) throw new NotFoundError('User', id);
      return user;
    },
  };
}

// Wire up in composition root
const userRepo = new PrismaUserRepository(prisma);
const userService = createUserService(userRepo);
```

### Export Patterns
- Use named exports (not default) for tree-shaking and refactoring
- Export types separately from implementations when appropriate
- Avoid barrel files (`index.ts` re-exporting everything) in large projects — hurts tree-shaking and circular deps
- Export factory functions over classes when possible (more composable)

---

## Testing Patterns

### Test Structure

```typescript
describe('UserService', () => {
  describe('getUser', () => {
    it('should return user when found', async () => {
      // Arrange
      const repo = { findById: vi.fn().mockResolvedValue({ id: '1', name: 'Alice' }) };
      const service = createUserService(repo);

      // Act
      const user = await service.getUser('1');

      // Assert
      expect(user).toEqual({ id: '1', name: 'Alice' });
      expect(repo.findById).toHaveBeenCalledWith('1');
    });

    it('should throw NotFoundError when user missing', async () => {
      const repo = { findById: vi.fn().mockResolvedValue(null) };
      const service = createUserService(repo);

      await expect(service.getUser('1')).rejects.toThrow(NotFoundError);
    });
  });
});
```

### What to Test

| Priority | Test | Why |
|----------|------|-----|
| High | Business logic (services) | Core value, most bugs |
| High | Input validation | Security boundary |
| Medium | API contracts (request/response shapes) | Integration correctness |
| Medium | Error paths | Graceful degradation |
| Low | Simple mappers/formatters | Low bug risk |
| Never | Framework/library internals | Not your code |

### Testing Rules
- Test behavior, not implementation details
- One logical assertion per test (multiple `expect` calls are fine if testing one behavior)
- Use factories for test data, not shared fixtures
- Mock at boundaries (database, HTTP, file system), not internal modules
- Prefer integration tests over unit tests for API routes

---

## Security

### Input Validation
```typescript
import { z } from 'zod';

const CreateUserSchema = z.object({
  email: z.string().email().max(255),
  name: z.string().min(1).max(100).trim(),
  age: z.number().int().min(0).max(150).optional(),
});

// Validate at API boundary
function handleCreateUser(req: Request) {
  const input = CreateUserSchema.parse(req.body); // Throws on invalid
  return userService.create(input);
}
```

### Common Vulnerabilities

| Vulnerability | Prevention |
|--------------|------------|
| **Prototype pollution** | Use `Object.create(null)` for lookup objects, validate JSON keys |
| **ReDoS** | Avoid complex regex on user input, use `re2` for untrusted patterns |
| **Path traversal** | Validate and normalize paths, use `path.resolve` + check prefix |
| **Command injection** | Never use `exec` with user input, use `spawn` with args array |
| **SQL injection** | Always use parameterized queries (ORMs handle this) |
| **XSS** | Use framework auto-escaping, sanitize HTML with DOMPurify |
| **SSRF** | Validate/allowlist URLs before fetching, block private IP ranges |
| **Timing attacks** | Use `crypto.timingSafeEqual` for secret comparison |

### Secrets Management
- Use environment variables (never hardcode)
- Use `.env` files for local dev only (never commit)
- `crypto.randomBytes(32)` for generating tokens (not `Math.random`)
- `crypto.timingSafeEqual` for comparing secrets
- `argon2` or `bcrypt` for password hashing (never SHA/MD5)

---

## Code Quality Patterns

### Null/Undefined Handling

```typescript
// GOOD: Nullish coalescing (handles null/undefined only)
const name = user.name ?? 'Anonymous';

// BAD: Logical OR (also catches 0, '', false)
const name = user.name || 'Anonymous'; // '' becomes 'Anonymous' — probably wrong

// GOOD: Optional chaining
const city = user?.address?.city;

// GOOD: Early return pattern
function processUser(user: User | null) {
  if (!user) return; // Guard clause
  // ... rest of logic with user guaranteed non-null
}
```

### Immutability Patterns

```typescript
// GOOD: Spread for shallow copy
const updated = { ...user, name: 'New Name' };
const withItem = [...items, newItem];
const without = items.filter(i => i.id !== targetId);

// GOOD: structuredClone for deep copy (Node 17+, all modern browsers)
const deep = structuredClone(complexObject);

// GOOD: Object.freeze for constants (shallow)
const CONFIG = Object.freeze({ maxRetries: 3, timeout: 5000 });
```

### Iteration Patterns

```typescript
// for...of for arrays (readable, supports break/continue/await)
for (const item of items) { /* ... */ }

// for...of with entries for index
for (const [index, item] of items.entries()) { /* ... */ }

// Object iteration
for (const [key, value] of Object.entries(obj)) { /* ... */ }

// Map iteration (preserves insertion order)
for (const [key, value] of map) { /* ... */ }

// Avoid: for...in (iterates prototype chain, wrong for arrays)
```

### Modern JavaScript Features to Prefer

| Old Pattern | Modern Replacement |
|------------|-------------------|
| `var` | `const` / `let` |
| `function` keyword | Arrow functions (for non-methods) |
| `arguments` object | Rest parameters `...args` |
| String concatenation | Template literals |
| `obj.hasOwnProperty(k)` | `Object.hasOwn(obj, k)` |
| `Array.isArray` + index | `Array.prototype.at(-1)` for last element |
| `JSON.parse(JSON.stringify(obj))` | `structuredClone(obj)` |
| `Promise.resolve().then()` | `queueMicrotask()` |
| `util.promisify(fn)` | `fs/promises`, native async APIs |
