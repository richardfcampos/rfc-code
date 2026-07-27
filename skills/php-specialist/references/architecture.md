# Architecture & Design Patterns

## Table of Contents
- [SOLID Principles in PHP](#solid-principles-in-php)
- [Design Patterns by Use Case](#design-patterns-by-use-case)
- [Laravel Architecture Patterns](#laravel-architecture-patterns)
- [WordPress Architecture Patterns](#wordpress-architecture-patterns)
- [When to Use What](#when-to-use-what)
- [Anti-Patterns to Avoid](#anti-patterns-to-avoid)

## SOLID Principles in PHP

### S — Single Responsibility
```php
// Bad: does too much.
class UserService {
    public function register(array $data): User { /* validates, creates, sends email, logs */ }
}

// Good: each class has one job.
final class RegisterUserAction {
    public function __construct(
        private readonly UserRepository $users,
        private readonly UserValidator $validator,
    ) {}

    public function execute(RegisterUserDto $dto): User {
        $this->validator->validate($dto);
        $user = $this->users->create($dto);
        event(new UserRegistered($user));
        return $user;
    }
}

// Email sending handled by event listener.
class SendWelcomeEmail {
    public function handle(UserRegistered $event): void {
        Mail::to($event->user)->send(new WelcomeEmail($event->user));
    }
}
```

### O — Open/Closed
```php
// Extend via interface + implementations, not modification.
interface PaymentGateway {
    public function charge(Money $amount): PaymentResult;
}

final class StripeGateway implements PaymentGateway {
    public function charge(Money $amount): PaymentResult { /* Stripe logic */ }
}

final class PayPalGateway implements PaymentGateway {
    public function charge(Money $amount): PaymentResult { /* PayPal logic */ }
}

// Adding a new gateway = new class, no changes to existing code.

// WordPress: extend via hooks, not modification.
add_filter('rgbc_brand_display', function (string $html, int $brand_id): string {
    return $html . rgbc_get_brand_badge($brand_id);
}, 10, 2);
```

### L — Liskov Substitution
```php
// Any implementation must be interchangeable.
interface CacheStore {
    public function get(string $key): mixed;
    public function put(string $key, mixed $value, int $ttl): void;
}

// Both work identically from consumer's perspective.
final class RedisCache implements CacheStore { /* ... */ }
final class FileCache implements CacheStore { /* ... */ }

function warmCache(CacheStore $cache): void {
    // Works with any CacheStore — no type checking needed.
    $cache->put('key', 'value', 3600);
}
```

### I — Interface Segregation
```php
// Bad: forces implementors to implement methods they don't need.
interface Repository {
    public function find(int $id): ?object;
    public function create(array $data): object;
    public function update(int $id, array $data): object;
    public function delete(int $id): void;
    public function export(): string;    // Not all repos need export.
    public function import(string $data): void; // Not all repos need import.
}

// Good: split into focused interfaces.
interface Readable {
    public function find(int $id): ?object;
}

interface Writable {
    public function create(array $data): object;
    public function update(int $id, array $data): object;
    public function delete(int $id): void;
}

interface Exportable {
    public function export(): string;
}

// Implement only what's needed.
final class UserRepository implements Readable, Writable { /* ... */ }
final class ReportRepository implements Readable, Exportable { /* ... */ }
```

### D — Dependency Inversion
```php
// Bad: depends on concrete implementation.
class OrderService {
    private StripeGateway $gateway;

    public function __construct() {
        $this->gateway = new StripeGateway(); // Tightly coupled.
    }
}

// Good: depends on abstraction.
class OrderService {
    public function __construct(
        private readonly PaymentGateway $gateway, // Interface, not concrete.
    ) {}
}

// Laravel binding.
$this->app->bind(PaymentGateway::class, StripeGateway::class);

// WordPress: use dependency injection where practical.
function rgbc_create_order_service(): OrderService {
    return new OrderService(
        gateway: rgbc_get_payment_gateway(),
    );
}
```

## Design Patterns by Use Case

### Repository Pattern (data access abstraction)
```php
interface OrderRepository {
    public function find(int $id): ?Order;
    public function findByUser(int $userId): Collection;
    public function save(Order $order): void;
}

final class EloquentOrderRepository implements OrderRepository {
    public function find(int $id): ?Order {
        return Order::find($id);
    }

    public function findByUser(int $userId): Collection {
        return Order::where('user_id', $userId)
            ->with('items')
            ->latest()
            ->get();
    }

    public function save(Order $order): void {
        $order->save();
    }
}
```

**When to use:** When you need to decouple business logic from database implementation, enable testability with mock repositories, or switch data sources.

### Strategy Pattern (interchangeable algorithms)
```php
interface PricingStrategy {
    public function calculate(Order $order): Money;
}

final class StandardPricing implements PricingStrategy {
    public function calculate(Order $order): Money {
        return $order->subtotal();
    }
}

final class DiscountPricing implements PricingStrategy {
    public function __construct(
        private readonly float $discountPercent,
    ) {}

    public function calculate(Order $order): Money {
        return $order->subtotal()->multiply(1 - $this->discountPercent / 100);
    }
}

// Usage.
final class CheckoutService {
    public function __construct(
        private readonly PricingStrategy $pricing,
    ) {}

    public function calculateTotal(Order $order): Money {
        return $this->pricing->calculate($order);
    }
}
```

**When to use:** Multiple algorithms for the same task, needs to switch behavior at runtime, avoid conditionals that select behavior.

### Observer/Event Pattern
```php
// Laravel events.
class OrderCreated {
    public function __construct(
        public readonly Order $order,
    ) {}
}

// Listeners — each handles one concern.
class SendOrderConfirmation {
    public function handle(OrderCreated $event): void { /* email */ }
}

class UpdateInventory {
    public function handle(OrderCreated $event): void { /* stock */ }
}

class NotifyWarehouse {
    public function handle(OrderCreated $event): void { /* webhook */ }
}

// WordPress: same concept via hooks.
do_action('rgbc_order_created', $order_id, $order_data);
```

**When to use:** Multiple systems need to react to the same event, decouple the trigger from the handlers.

### Builder Pattern (complex object construction)
```php
final class QueryBuilder {
    private array $conditions = [];
    private ?int $limit = null;
    private ?string $orderBy = null;

    public function where(string $field, mixed $value): self {
        $this->conditions[] = [$field, $value];
        return $this;
    }

    public function limit(int $limit): self {
        $this->limit = $limit;
        return $this;
    }

    public function orderBy(string $field, string $direction = 'ASC'): self {
        $this->orderBy = "{$field} {$direction}";
        return $this;
    }

    public function build(): Query {
        return new Query($this->conditions, $this->limit, $this->orderBy);
    }
}
```

**When to use:** Object creation involves many optional parameters, fluent API improves readability.

### Value Object Pattern (immutable domain concepts)
```php
readonly class Money {
    public function __construct(
        public int $cents,
        public string $currency = 'USD',
    ) {
        if ($cents < 0) {
            throw new \InvalidArgumentException('Amount cannot be negative');
        }
    }

    public function add(self $other): self {
        $this->assertSameCurrency($other);
        return new self($this->cents + $other->cents, $this->currency);
    }

    public function multiply(float $factor): self {
        return new self((int) round($this->cents * $factor), $this->currency);
    }

    public function format(): string {
        return number_format($this->cents / 100, 2) . ' ' . $this->currency;
    }

    private function assertSameCurrency(self $other): void {
        if ($this->currency !== $other->currency) {
            throw new \InvalidArgumentException('Cannot operate on different currencies');
        }
    }
}
```

**When to use:** Concepts defined by their values (money, email, coordinates), equality by value not identity, immutability needed.

## Laravel Architecture Patterns

### Action Pattern (recommended for most logic)
```
app/Actions/
├── Order/
│   ├── CreateOrderAction.php
│   ├── CancelOrderAction.php
│   └── RefundOrderAction.php
├── User/
│   ├── RegisterUserAction.php
│   └── UpdateProfileAction.php
```

One public method (`execute`), one responsibility, easy to test.

### Service Pattern (complex orchestration)
Use services when multiple actions need coordination or when managing external API interactions with retry logic, error handling, and circuit breaking.

### Pipeline Pattern (sequential transformations)
```php
// Laravel's Pipeline for sequential processing.
$result = Pipeline::send($order)
    ->through([
        ValidateInventory::class,
        ApplyDiscount::class,
        CalculateTax::class,
        CalculateShipping::class,
    ])
    ->thenReturn();
```

### Feature Flags
```php
// Simple implementation.
if (Feature::active('new-checkout')) {
    return $this->newCheckoutFlow($order);
}
return $this->legacyCheckoutFlow($order);
```

## WordPress Architecture Patterns

### Module Pattern (used in RGBCode)
```php
// Each includes/*.php file follows this pattern.
namespace rgbcTheme\Brands;

function start(): void {
    add_action('init', __NAMESPACE__ . '\register_post_type');
    add_filter('the_content', __NAMESPACE__ . '\filter_content');
    add_action('save_post_brand', __NAMESPACE__ . '\on_save');
}

function register_post_type(): void { /* ... */ }
function filter_content(string $content): string { /* ... */ }
function on_save(int $post_id): void { /* ... */ }
```

Bootstrap in `functions.php`:
```php
require_once RGBC_THEME_INCLUDES . '/brands.php';
rgbcTheme\Brands\start();
```

### Hook-Based Extension
```php
// Define extension points in your code.
$output = apply_filters('rgbc_brand_card_html', $html, $brand_id, $context);

// Let other code extend without modification.
add_filter('rgbc_brand_card_html', function (string $html, int $brand_id): string {
    // Add affiliate badge if applicable.
    if (has_term('affiliate', 'brand_type', $brand_id)) {
        $html .= '<span class="badge badge--affiliate">Affiliate</span>';
    }
    return $html;
}, 10, 2);
```

### Singleton/Registry (for expensive objects)
```php
function rgbc_get_api_client(): MatrixApiClient {
    static $client = null;

    if ($client === null) {
        $client = new MatrixApiClient(
            base_url: get_option('rgbc_matrix_api_url'),
            api_key: get_option('rgbc_matrix_api_key'),
        );
    }

    return $client;
}
```

## When to Use What

| Scenario | Pattern | Why |
|----------|---------|-----|
| Single operation with clear input/output | Action | Simple, testable, composable |
| Multiple related operations | Service | Coordinates actions, manages state |
| Data access abstraction | Repository | Decouples from ORM/database |
| Multiple algorithms for same task | Strategy | Runtime flexibility, OCP |
| React to something happening | Observer/Event | Decouples trigger from handlers |
| Complex object creation | Builder | Readable, flexible construction |
| Domain concept with equality by value | Value Object | Immutable, self-validating |
| Sequential data transformation | Pipeline | Clean, composable steps |
| WordPress: module initialization | Module + start() | Follows codebase convention |
| WordPress: extensibility | Hooks (actions/filters) | WP-native, discoverable |

## Anti-Patterns to Avoid

| Anti-Pattern | Problem | Fix |
|-------------|---------|-----|
| God class | Single class does everything | Split by responsibility |
| Anemic domain model | Models are just data bags | Add behavior to domain objects |
| Service locator | Hidden dependencies | Use constructor injection |
| Premature abstraction | Abstraction for one use case | Wait for 2+ concrete uses |
| Deep inheritance | Fragile base class problem | Prefer composition |
| Circular dependencies | A depends on B depends on A | Introduce interface/event |
| Shotgun surgery | One change touches many files | Consolidate related logic |
| Feature envy | Method uses another class's data more than its own | Move method to that class |
| Magic strings/numbers | `if ($status === 'active')` | Use enums/constants |
| Over-engineering | 5 layers for a CRUD operation | Match complexity to need |
