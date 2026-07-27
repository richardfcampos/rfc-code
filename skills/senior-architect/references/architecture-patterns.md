# Architecture Patterns Reference (Next.js / Node Full-Stack)

## Table of Contents

1. [Project Structure Patterns](#project-structure-patterns)
2. [Data Flow Patterns](#data-flow-patterns)
3. [API Design Patterns](#api-design-patterns)
4. [State Management Patterns](#state-management-patterns)
5. [Performance Patterns](#performance-patterns)
6. [Security Patterns](#security-patterns)
7. [Testing Architecture](#testing-architecture)

---

## Project Structure Patterns

### Feature-Based (Recommended for most projects)
Group by feature/domain rather than by technical layer.

```
src/
├── features/
│   ├── auth/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── services/
│   │   ├── types.ts
│   │   └── index.ts
│   ├── dashboard/
│   └── users/
├── shared/
│   ├── components/
│   ├── hooks/
│   ├── lib/
│   └── types/
├── app/ (Next.js App Router)
└── server/
    ├── services/
    ├── repositories/
    └── middleware/
```

**Trade-offs:**
- (+) High cohesion within features, easier to navigate
- (+) Clear ownership boundaries, scales with team size
- (-) Shared code requires discipline to avoid circular deps

### Layer-Based (Simpler projects)
Group by technical concern.

```
src/
├── components/
├── hooks/
├── services/
├── utils/
├── types/
└── app/
```

**Trade-offs:**
- (+) Simple, familiar, low overhead
- (-) Features spread across many directories
- (-) Harder to maintain boundaries as project grows

### Vertical Slice
Each feature is a self-contained slice from UI to database.

**Trade-offs:**
- (+) Maximum feature isolation, deployable independently
- (-) Code duplication across slices, harder to share logic

---

## Data Flow Patterns

### Server Components + Server Actions (Next.js App Router)
Prefer server components for data fetching. Use server actions for mutations.

```
User → Server Component (fetch data) → Client Component (interactivity)
User → Client Component → Server Action (mutation) → revalidate
```

**When to use:** Default for Next.js 14+ projects. Best for SEO, initial load performance.

### API Routes + Client Fetching
Traditional REST or GraphQL endpoints consumed by client components.

```
User → Client Component → fetch('/api/...') → API Route → Database
```

**When to use:** When you need a public API, mobile app support, or complex client-side state.

### Hybrid
Server components for initial data, API routes for dynamic updates.

**When to use:** Real-time features, complex forms, or progressive enhancement.

---

## API Design Patterns

### RESTful Resource Design
```
GET    /api/users          → List users (with pagination, filtering)
GET    /api/users/:id      → Get single user
POST   /api/users          → Create user
PATCH  /api/users/:id      → Partial update
DELETE /api/users/:id      → Delete user
POST   /api/users/:id/actions/deactivate → Custom actions
```

### API Response Envelope
```typescript
// Success
{ data: T, meta?: { page, total, ... } }

// Error
{ error: { code: string, message: string, details?: unknown } }
```

### Pagination
- **Offset-based:** Simple, supports random access. `?page=2&limit=20`
- **Cursor-based:** Better for real-time data, no skipped/duplicated items. `?cursor=abc&limit=20`

### Rate Limiting Strategy
- Per-user token bucket for authenticated endpoints
- Per-IP sliding window for public endpoints
- Separate limits for read vs. write operations

---

## State Management Patterns

### Decision Matrix

| Scenario | Recommendation |
|----------|---------------|
| Server data caching | React Query / SWR |
| Simple local UI state | useState / useReducer |
| Cross-component state (small) | React Context |
| Complex client state | Zustand (lightweight) or Redux Toolkit |
| Form state | React Hook Form / Formik |
| URL-driven state | searchParams / nuqs |

### Data Fetching Layer
```
Component → Custom Hook → React Query → API Client → Server
                              ↓
                         Cache Layer
```

**Rules:**
- Components never call APIs directly
- Custom hooks encapsulate query keys and fetch logic
- API client handles auth headers, base URL, error normalization

---

## Performance Patterns

### Rendering Strategy Selection

| Content Type | Strategy | Cache |
|-------------|----------|-------|
| Marketing pages | SSG (Static) | CDN, long TTL |
| User dashboards | SSR + streaming | Short TTL, revalidate |
| Interactive tools | CSR (Client) | SWR / React Query |
| Frequently updated lists | ISR | revalidate: 60s |

### Database Query Optimization
- Index columns used in WHERE, JOIN, ORDER BY
- Use SELECT only needed columns (avoid SELECT *)
- Batch related queries (Promise.all or JOIN)
- Use connection pooling (PgBouncer, Prisma pool)
- Add query result caching for expensive reads (Redis / in-memory)

### Bundle Optimization
- Dynamic imports for heavy components: `dynamic(() => import('./HeavyChart'))`
- Tree-shake by using named exports and barrel files carefully
- Analyze with `@next/bundle-analyzer`
- Split vendor chunks for better caching

---

## Security Patterns

### Authentication Architecture
```
Client → Auth Provider (NextAuth/Clerk/Auth0)
           ↓
       Session/JWT → Middleware (verify) → API Route → Business Logic
```

### Authorization Layers
1. **Middleware:** Route-level access control
2. **API Route:** Resource-level permission checks
3. **Service Layer:** Business rule enforcement
4. **Database:** Row-level security (if supported)

### Input Validation
- Validate at API boundary with Zod schemas
- Share validation schemas between client and server
- Never trust client-side validation alone

```typescript
const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  role: z.enum(['user', 'admin']),
});
// Use in both form validation and API route
```

### Common Vulnerabilities to Prevent
- **XSS:** Sanitize user-generated HTML, use React's built-in escaping
- **CSRF:** Use SameSite cookies, verify origin headers
- **SQL Injection:** Always use parameterized queries (Prisma/ORMs handle this)
- **IDOR:** Always verify resource ownership in API routes
- **Secrets:** Never expose server env vars to client (NEXT_PUBLIC_ prefix only for public values)

---

## Testing Architecture

### Testing Pyramid for Full-Stack Next.js

```
         /  E2E  \          ← Playwright: critical user flows (5-10%)
        / Integration \     ← API routes + services with test DB (30%)
       /    Unit Tests  \   ← Pure functions, hooks, utils (60%)
```

### What to Test Where

| Layer | Tool | Focus |
|-------|------|-------|
| Components | Vitest + Testing Library | Rendering, user interactions |
| Hooks | Vitest + renderHook | State transitions, side effects |
| API Routes | Vitest + supertest | Request/response contracts |
| Services | Vitest | Business logic, edge cases |
| E2E | Playwright | Critical user journeys |

### Test Organization
Co-locate tests with source files:
```
features/auth/
├── components/LoginForm.tsx
├── components/LoginForm.test.tsx
├── services/auth.service.ts
└── services/auth.service.test.ts
```
