# PHP Internals & Best Practices

## Table of Contents
- [PHP 8.x Features to Always Use](#php-8x-features-to-always-use)
- [Type System Mastery](#type-system-mastery)
- [OOP Patterns](#oop-patterns)
- [Error Handling](#error-handling)
- [Memory & Performance](#memory--performance)
- [Common Pitfalls](#common-pitfalls)

## PHP 8.x Features to Always Use

### Strict Types (mandatory in every file)
```php
declare(strict_types=1);
```

### Enums (replace class constants for finite sets)
```php
// Bad: class constants.
class Status {
    const ACTIVE = 'active';
    const INACTIVE = 'inactive';
}

// Good: backed enum.
enum Status: string {
    case Active = 'active';
    case Inactive = 'inactive';
}
```

### Readonly Classes & Properties
```php
// Value object — immutable by design.
readonly class Money {
    public function __construct(
        public int $amount,
        public string $currency,
    ) {}
}
```

### Match Expressions (replace switch)
```php
$result = match($status) {
    Status::Active => 'enabled',
    Status::Inactive => 'disabled',
    default => throw new \UnexpectedValueException("Unknown status: {$status->value}"),
};
```

### Named Arguments (for readability at call sites)
```php
// Clear intent, self-documenting.
$user = new User(
    name: $name,
    email: $email,
    role: Role::Admin,
);
```

### Fibers (cooperative multitasking)
```php
// Use for async I/O without full event loop libraries.
$fiber = new Fiber(function (): void {
    $value = Fiber::suspend('paused');
    echo $value; // 'resumed'.
});

$result = $fiber->start();   // 'paused'.
$fiber->resume('resumed');
```

### Constructor Promotion
```php
class UserService {
    public function __construct(
        private readonly UserRepository $repository,
        private readonly CacheInterface $cache,
    ) {}
}
```

### Intersection & Union Types
```php
// Union: accepts multiple types.
function parse(string|int $input): string {}

// Intersection: must implement all.
function process(Countable&Iterator $collection): void {}

// Nullable shorthand.
function find(int $id): ?User {}
```

### First-Class Callable Syntax
```php
// Instead of Closure::fromCallable().
$fn = strlen(...);
$mapped = array_map(strtoupper(...), $items);
```

## Type System Mastery

### Always Declare
- Parameter types on every function/method.
- Return types on every function/method (including `: void`).
- Property types on every class property.
- `never` return type for functions that always throw or exit.

### Strict Comparisons
```php
// Always use strict.
if ($value === null) {}
if ($status === Status::Active) {}

// Never use loose.
// if ($value == null) {}  // Dangerous — '' == null is true.
```

### Null Safety
```php
// Nullsafe operator — short-circuit on null.
$country = $user?->address?->country;

// Null coalescing — provide defaults.
$name = $input['name'] ?? 'Anonymous';

// Null coalescing assignment.
$config['timeout'] ??= 30;
```

## OOP Patterns

### Interfaces for Contracts
```php
interface PaymentGateway {
    public function charge(Money $amount, PaymentMethod $method): Transaction;
    public function refund(Transaction $transaction): RefundResult;
}
```

### Abstract Classes for Shared Behavior
```php
abstract class BaseRepository {
    abstract protected function getModelClass(): string;

    public function find(int $id): ?object {
        // Shared implementation.
    }
}
```

### Traits for Horizontal Reuse (sparingly)
```php
// Good: small, focused behavior.
trait HasTimestamps {
    public readonly \DateTimeImmutable $createdAt;
    public readonly \DateTimeImmutable $updatedAt;
}

// Bad: large traits that become hidden inheritance. Prefer composition.
```

### Final by Default
```php
// Make classes final unless designed for extension.
final class InvoiceCalculator {
    // Forces composition over inheritance.
}
```

## Error Handling

### Exception Hierarchy
```php
// Domain-specific exceptions.
class DomainException extends \RuntimeException {}
class InsufficientFundsException extends DomainException {
    public function __construct(
        public readonly Money $required,
        public readonly Money $available,
    ) {
        parent::__construct("Insufficient funds: need {$required->amount}, have {$available->amount}");
    }
}
```

### Try-Catch Strategy
```php
// Catch specific, never catch generic \Exception at domain level.
try {
    $gateway->charge($amount, $method);
} catch (PaymentDeclinedException $e) {
    // Handle declined — expected business case.
    return Result::declined($e->reason);
} catch (GatewayTimeoutException $e) {
    // Handle timeout — retry or queue.
    dispatch(new RetryPayment($order));
}
// Let unexpected exceptions bubble up to global handler.
```

### Never Suppress Errors
```php
// Never use @.
// $data = @file_get_contents($path); // Bad.

// Handle explicitly.
$data = file_get_contents($path);
if ($data === false) {
    throw new FileReadException("Failed to read: {$path}");
}
```

## Memory & Performance

### Generators for Large Datasets
```php
// Instead of loading millions of rows into memory.
function readCsv(string $path): \Generator {
    $handle = fopen($path, 'r');
    while (($row = fgetcsv($handle)) !== false) {
        yield $row;
    }
    fclose($handle);
}

foreach (readCsv('large-file.csv') as $row) {
    // Processes one row at a time — constant memory.
}
```

### WeakMap for Caching Without Leaks
```php
$cache = new WeakMap();

function computeExpensive(object $key, WeakMap $cache): mixed {
    return $cache[$key] ??= expensiveOperation($key);
    // Automatically freed when $key is garbage collected.
}
```

### String Performance
- `str_contains()`, `str_starts_with()`, `str_ends_with()` — use these, not `strpos()`.
- Use `sprintf()` for complex formatting, interpolation for simple cases.
- Avoid repeated concatenation in loops — use `implode()` with array.

## Common Pitfalls

| Pitfall | Problem | Fix |
|---------|---------|-----|
| `==` comparison | `0 == 'foo'` is true in older PHP | Always use `===` |
| `array_merge` in loop | O(n^2) memory | Use spread: `[...$a, ...$b]` or `array_push` |
| `empty()` | Too loose — `empty('0')` is true | Explicit null/type checks |
| `isset()` on false | `isset` returns true for `false` | Use `array_key_exists()` when needed |
| Global state | Hidden dependencies, untestable | Dependency injection |
| Dynamic properties | Deprecated in 8.2, removed in 9.0 | Use typed properties or `#[AllowDynamicProperties]` |
| `serialize()` for storage | Insecure deserialization risk | Use `json_encode()`/`json_decode()` |
