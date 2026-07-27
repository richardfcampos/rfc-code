# Laravel Patterns & Best Practices

## Table of Contents
- [Architecture & Structure](#architecture--structure)
- [Eloquent & Database](#eloquent--database)
- [Request Lifecycle](#request-lifecycle)
- [Service Layer](#service-layer)
- [Queues & Jobs](#queues--jobs)
- [Testing](#testing)
- [API Design](#api-design)
- [Common Anti-Patterns](#common-anti-patterns)

## Architecture & Structure

### Directory Organization
```
app/
├── Actions/          # Single-purpose action classes.
├── DTOs/             # Data Transfer Objects (readonly classes).
├── Enums/            # PHP 8.1+ backed enums.
├── Events/           # Domain events.
├── Exceptions/       # Custom exception classes.
├── Http/
│   ├── Controllers/  # Thin — delegate to actions/services.
│   ├── Middleware/
│   ├── Requests/     # Form request validation.
│   └── Resources/    # API resources (JSON transformation).
├── Jobs/             # Queueable jobs.
├── Listeners/        # Event listeners.
├── Mail/
├── Models/           # Eloquent models (relationships, scopes, casts).
├── Notifications/
├── Policies/         # Authorization policies.
├── Providers/        # Service providers (minimal, only bindings).
├── Rules/            # Custom validation rules.
└── Services/         # Complex business logic (when action isn't enough).
```

### Thin Controllers
```php
// Good: controller delegates to action.
class OrderController extends Controller
{
    public function store(StoreOrderRequest $request, CreateOrderAction $action): JsonResponse
    {
        $order = $action->execute($request->toDto());

        return OrderResource::make($order)
            ->response()
            ->setStatusCode(Response::HTTP_CREATED);
    }
}
```

### Action Classes (single responsibility)
```php
final class CreateOrderAction
{
    public function __construct(
        private readonly OrderRepository $orders,
        private readonly PaymentService $payments,
    ) {}

    public function execute(CreateOrderDto $dto): Order
    {
        return DB::transaction(function () use ($dto): Order {
            $order = $this->orders->create($dto);
            $this->payments->authorize($order);

            event(new OrderCreated($order));

            return $order;
        });
    }
}
```

### DTOs (data integrity at boundaries)
```php
final readonly class CreateOrderDto
{
    public function __construct(
        public int $userId,
        public array $items,
        public PaymentMethod $paymentMethod,
        public ?string $couponCode = null,
    ) {}

    public static function fromRequest(StoreOrderRequest $request): self
    {
        return new self(
            userId: $request->user()->id,
            items: $request->validated('items'),
            paymentMethod: PaymentMethod::from($request->validated('payment_method')),
            couponCode: $request->validated('coupon_code'),
        );
    }
}
```

## Eloquent & Database

### Model Best Practices
```php
class Order extends Model
{
    // Always define fillable (never use guarded = []).
    protected $fillable = [
        'user_id',
        'status',
        'total_cents',
        'currency',
    ];

    // Use casts for type safety.
    protected function casts(): array
    {
        return [
            'status' => OrderStatus::class,
            'total_cents' => 'integer',
            'paid_at' => 'immutable_datetime',
            'metadata' => 'array',
        ];
    }

    // Relationships: always type-hint return.
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(OrderItem::class);
    }

    // Scopes: use query builder type hint.
    public function scopeActive(Builder $query): Builder
    {
        return $query->where('status', OrderStatus::Active);
    }

    // Accessors & Mutators: use Attribute.
    protected function totalFormatted(): Attribute
    {
        return Attribute::get(
            fn (): string => number_format($this->total_cents / 100, 2),
        );
    }
}
```

### Preventing N+1 Queries
```php
// Always eager load when you know relationships will be used.
$orders = Order::with(['user', 'items.product'])->paginate(20);

// Use preventLazyLoading in development.
// In AppServiceProvider::boot():
Model::preventLazyLoading(! app()->isProduction());

// Use withCount for aggregate data.
$users = User::withCount('orders')->get();
```

### Query Optimization
```php
// Use chunking for large datasets.
Order::where('status', 'pending')
    ->chunkById(500, function (Collection $orders): void {
        foreach ($orders as $order) {
            ProcessOrder::dispatch($order);
        }
    });

// Use select to limit columns.
$names = User::select(['id', 'name', 'email'])->get();

// Use raw expressions for complex aggregations.
$stats = Order::query()
    ->selectRaw('DATE(created_at) as date, COUNT(*) as count, SUM(total_cents) as revenue')
    ->groupByRaw('DATE(created_at)')
    ->get();
```

### Migrations Best Practices
```php
// Always add indexes for foreign keys and frequently queried columns.
Schema::create('orders', function (Blueprint $table): void {
    $table->id();
    $table->foreignId('user_id')->constrained()->cascadeOnDelete();
    $table->string('status')->index();
    $table->integer('total_cents');
    $table->timestamp('paid_at')->nullable()->index();
    $table->timestamps();

    // Composite index for common queries.
    $table->index(['status', 'created_at']);
});
```

## Request Lifecycle

### Form Requests (validation + authorization)
```php
final class StoreOrderRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('create', Order::class);
    }

    public function rules(): array
    {
        return [
            'items' => ['required', 'array', 'min:1'],
            'items.*.product_id' => ['required', 'exists:products,id'],
            'items.*.quantity' => ['required', 'integer', 'min:1', 'max:100'],
            'payment_method' => ['required', Rule::enum(PaymentMethod::class)],
            'coupon_code' => ['nullable', 'string', 'exists:coupons,code'],
        ];
    }

    public function toDto(): CreateOrderDto
    {
        return CreateOrderDto::fromRequest($this);
    }
}
```

### Middleware Patterns
```php
// Rate limiting per user.
RateLimiter::for('api', function (Request $request): Limit {
    return Limit::perMinute(60)->by($request->user()?->id ?: $request->ip());
});

// Custom middleware: keep it focused.
class EnsureTeamMember
{
    public function handle(Request $request, Closure $next): Response
    {
        $team = $request->route('team');

        abort_unless($request->user()->belongsToTeam($team), 403);

        return $next($request);
    }
}
```

## Service Layer

### When to Use Services vs Actions
- **Action**: Single operation, one public method (`execute`), easily testable.
- **Service**: Multiple related operations, coordinates complex workflows, may call multiple actions.

```php
// Service for complex domain logic.
final class PaymentService
{
    public function __construct(
        private readonly PaymentGateway $gateway,
        private readonly RefundPolicy $policy,
    ) {}

    public function charge(Order $order): PaymentResult
    {
        try {
            $result = $this->gateway->charge(
                amount: $order->total_cents,
                currency: $order->currency,
                method: $order->paymentMethod,
            );

            $order->markAsPaid($result->transactionId);

            return $result;
        } catch (PaymentFailedException $e) {
            Log::error('Payment failed', ['order' => $order->id, 'error' => $e->getMessage()]);
            throw $e;
        }
    }

    public function refund(Order $order): RefundResult
    {
        $this->policy->assertRefundable($order);

        return $this->gateway->refund($order->payment_transaction_id);
    }
}
```

## Queues & Jobs

### Job Best Practices
```php
final class ProcessOrderJob implements ShouldQueue
{
    use Queueable;

    // Retry configuration.
    public int $tries = 3;
    public int $backoff = 60;
    public int $timeout = 120;

    public function __construct(
        public readonly int $orderId,
    ) {}

    public function handle(OrderProcessor $processor): void
    {
        $order = Order::findOrFail($this->orderId);
        $processor->process($order);
    }

    // Unique job — prevent duplicate processing.
    public function uniqueId(): string
    {
        return "process-order-{$this->orderId}";
    }

    public function failed(\Throwable $e): void
    {
        Log::critical('Order processing failed permanently', [
            'order_id' => $this->orderId,
            'error' => $e->getMessage(),
        ]);
    }
}
```

### Dispatching
```php
// Standard dispatch.
ProcessOrderJob::dispatch($order->id);

// Chained jobs.
Bus::chain([
    new ProcessPayment($order->id),
    new SendConfirmation($order->id),
    new UpdateInventory($order->id),
])->dispatch();

// Batch processing.
Bus::batch([
    new ImportUser($row1),
    new ImportUser($row2),
])->allowFailures()->dispatch();
```

## Testing

### Feature Tests (full stack)
```php
class OrderTest extends TestCase
{
    use RefreshDatabase;

    public function test_authenticated_user_can_create_order(): void
    {
        $user = User::factory()->create();
        $product = Product::factory()->create(['price_cents' => 1000]);

        $response = $this->actingAs($user)->postJson('/api/orders', [
            'items' => [
                ['product_id' => $product->id, 'quantity' => 2],
            ],
            'payment_method' => 'credit_card',
        ]);

        $response->assertCreated()
            ->assertJsonStructure(['data' => ['id', 'status', 'total']]);

        $this->assertDatabaseHas('orders', [
            'user_id' => $user->id,
            'status' => 'pending',
        ]);
    }

    public function test_guest_cannot_create_order(): void
    {
        $this->postJson('/api/orders', ['items' => []])
            ->assertUnauthorized();
    }
}
```

### Unit Tests (isolated logic)
```php
class OrderCalculatorTest extends TestCase
{
    public function test_calculates_total_with_discount(): void
    {
        $calculator = new OrderCalculator();
        $items = [
            new OrderItem(priceCents: 1000, quantity: 2),
            new OrderItem(priceCents: 500, quantity: 1),
        ];

        $total = $calculator->calculate($items, discountPercent: 10);

        $this->assertEquals(2250, $total); // (2000 + 500) * 0.9.
    }
}
```

### Mocking External Services
```php
public function test_payment_handles_gateway_failure(): void
{
    Http::fake([
        'payments.example.com/*' => Http::response(['error' => 'declined'], 402),
    ]);

    $this->expectException(PaymentDeclinedException::class);

    $service = app(PaymentService::class);
    $service->charge($this->order);
}
```

## API Design

### API Resources
```php
class OrderResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'status' => $this->status->value,
            'total' => $this->total_formatted,
            'items' => OrderItemResource::collection($this->whenLoaded('items')),
            'user' => UserResource::make($this->whenLoaded('user')),
            'created_at' => $this->created_at->toIso8601String(),
        ];
    }
}
```

### Versioning
- Use URL prefixing (`/api/v1/`, `/api/v2/`) for breaking changes.
- Use feature flags or request headers for minor variations.
- Never break existing API contracts without versioning.

## Common Anti-Patterns

| Anti-Pattern | Problem | Fix |
|-------------|---------|-----|
| Fat controllers | Business logic in controllers | Extract to Actions/Services |
| `$guarded = []` | Mass assignment vulnerability | Always define `$fillable` |
| Raw queries | SQL injection risk | Use Eloquent/Query Builder |
| `env()` outside config | Returns null when cached | Use `config()` helper |
| No queue for heavy ops | Blocks HTTP response | Dispatch jobs for slow tasks |
| Catching `\Exception` | Hides bugs | Catch specific exception types |
| No database transactions | Partial writes on failure | Wrap related writes in `DB::transaction()` |
| Missing indexes | Slow queries at scale | Add indexes for WHERE/JOIN columns |
| String-based status | Typo-prone, no type safety | Use backed enums |
| No request validation | Garbage in, garbage out | Use Form Requests |
