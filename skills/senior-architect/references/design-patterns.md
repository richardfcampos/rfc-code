# Design Patterns Reference

## Table of Contents

1. [SOLID Principles](#solid-principles)
2. [Creational Patterns](#creational-patterns)
3. [Structural Patterns](#structural-patterns)
4. [Behavioral Patterns](#behavioral-patterns)
5. [Full-Stack Patterns](#full-stack-patterns)

---

## SOLID Principles

### Single Responsibility (SRP)
A class/module should have one reason to change.

**Violation signal:** A module handles both data fetching and UI rendering, or a service handles both validation and persistence.

**Fix:** Extract into focused modules. In Next.js: separate API route handlers from business logic; keep React components focused on rendering.

```typescript
// BAD: Component fetches, transforms, and renders
function UserDashboard() {
  const [users, setUsers] = useState([]);
  useEffect(() => {
    fetch('/api/users').then(r => r.json()).then(data => {
      const transformed = data.map(u => ({ ...u, fullName: `${u.first} ${u.last}` }));
      setUsers(transformed);
    });
  }, []);
  return <Table data={users} />;
}

// GOOD: Separated concerns
function useUsers() { /* fetch + transform logic */ }
function UserDashboard() {
  const { users } = useUsers();
  return <Table data={users} />;
}
```

### Open/Closed (OCP)
Open for extension, closed for modification.

**Violation signal:** Adding a new feature requires modifying existing switch/if-else chains across multiple files.

**Fix:** Use strategy pattern, plugin architecture, or polymorphism. In React: composition over conditional rendering.

### Liskov Substitution (LSP)
Subtypes must be substitutable for their base types.

**Violation signal:** Code checks `instanceof` before calling methods, or overridden methods throw "not supported" errors.

**Fix:** Ensure derived classes honor the contract of their parent. Prefer composition over inheritance when contracts diverge.

### Interface Segregation (ISP)
No client should depend on methods it doesn't use.

**Violation signal:** Components receive large prop objects but only use 2-3 fields. Services import large interfaces but only call 1 method.

**Fix:** Split interfaces. In TypeScript: use `Pick<>`, smaller interfaces, or separate hook return types.

### Dependency Inversion (DIP)
Depend on abstractions, not concretions.

**Violation signal:** Business logic directly imports database clients, external SDKs, or framework-specific code.

**Fix:** Inject dependencies. In Next.js: use repository pattern for data access; pass services as function parameters or use DI containers.

---

## Creational Patterns

### Factory
**When to use:** Object creation logic is complex, varies by type, or should be decoupled from the consumer.

**Full-stack example:** API response parsers, notification service creation, database connection pooling.

```typescript
// Service factory for different notification channels
function createNotificationService(channel: 'email' | 'sms' | 'push') {
  const services = { email: EmailService, sms: SMSService, push: PushService };
  return new services[channel]();
}
```

### Builder
**When to use:** Object construction requires many optional parameters or step-by-step assembly.

**Full-stack example:** Query builders, form schema builders, complex API request construction.

### Singleton
**When to use:** Exactly one instance needed globally (database connections, config, caches).

**Caution:** Overuse creates hidden coupling. In Next.js, prefer module-scoped instances over class-based singletons.

```typescript
// Module-scoped singleton for Prisma in Next.js
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```

---

## Structural Patterns

### Adapter
**When to use:** Integrate third-party APIs or legacy code with incompatible interfaces.

**Full-stack example:** Wrapping different payment providers (Stripe, PayPal) behind a unified interface.

### Facade
**When to use:** Simplify a complex subsystem into a clean API.

**Full-stack example:** A `UserService` facade that coordinates between auth, profile, and permissions modules.

### Decorator / Higher-Order Function
**When to use:** Add behavior to functions/components without modifying them.

**Full-stack example:** Auth middleware wrapping API routes, React HOCs for feature flags, logging decorators.

```typescript
// API route decorator for auth
function withAuth(handler: NextApiHandler): NextApiHandler {
  return async (req, res) => {
    const session = await getSession(req);
    if (!session) return res.status(401).json({ error: 'Unauthorized' });
    return handler(req, res);
  };
}
```

### Composite
**When to use:** Tree structures where individual items and groups share the same interface.

**Full-stack example:** Permission systems, menu/navigation trees, form field groups.

---

## Behavioral Patterns

### Strategy
**When to use:** Multiple algorithms for the same task; selection happens at runtime.

**Full-stack example:** Pricing calculators, sorting algorithms, validation rule sets, file export formats.

```typescript
type PricingStrategy = (basePrice: number, user: User) => number;
const strategies: Record<string, PricingStrategy> = {
  standard: (price) => price,
  premium: (price) => price * 0.9,
  enterprise: (price, user) => price * user.discountRate,
};
```

### Observer / Event Emitter
**When to use:** Objects need to react to state changes without tight coupling.

**Full-stack example:** Real-time UI updates, webhook processing, pub/sub for microservices.

### Command
**When to use:** Encapsulate operations as objects for undo/redo, queuing, or logging.

**Full-stack example:** Action history in editors, job queues, audit trails.

### State Machine
**When to use:** Entity has well-defined states with controlled transitions.

**Full-stack example:** Order processing (pending → paid → shipped → delivered), form wizards, authentication flows.

```typescript
const orderTransitions: Record<OrderStatus, OrderStatus[]> = {
  pending: ['paid', 'cancelled'],
  paid: ['shipped', 'refunded'],
  shipped: ['delivered', 'returned'],
  delivered: [],
  cancelled: [],
};
```

---

## Full-Stack Patterns

### Repository Pattern
Abstracts data access behind a clean interface. Keeps business logic free of database specifics.

**When to use:** Any non-trivial data access, especially when you might swap databases or need testability.

### Service Layer
Encapsulates business logic separate from controllers/routes and data access.

**When to use:** Business logic spans multiple repositories or requires orchestration.

### DTO (Data Transfer Object)
Defines the shape of data crossing boundaries (API responses, service returns).

**When to use:** API contracts, decoupling internal models from external representations.

### CQRS (Command Query Responsibility Segregation)
Separate read and write models.

**When to use:** Read and write patterns differ significantly (e.g., complex dashboards with simple writes).

### Event-Driven Architecture
Decouple services through events rather than direct calls.

**When to use:** Multiple services react to the same action, async processing, audit requirements.
