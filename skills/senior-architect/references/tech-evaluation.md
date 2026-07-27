# Technology Evaluation Framework

## Table of Contents

1. [Evaluation Process](#evaluation-process)
2. [Evaluation Criteria](#evaluation-criteria)
3. [Trade-Off Analysis Framework](#trade-off-analysis-framework)
4. [Common Decision Scenarios](#common-decision-scenarios)

---

## Evaluation Process

Follow these steps when evaluating a technology choice:

1. **Define the problem** — What specific problem does this technology solve?
2. **Identify candidates** — List 2-4 realistic options (including "do nothing" or "build in-house")
3. **Evaluate against criteria** — Score each option using the criteria below
4. **Analyze trade-offs** — Document what you gain and what you give up
5. **Make a recommendation** — Choose the option with the best fit, not the best score
6. **Document the decision** — Use the ADR template in `assets/adr-template.md`

---

## Evaluation Criteria

### Must-Have Criteria (Disqualifying)
- **License compatibility** — Is the license compatible with the project?
- **Security posture** — Known vulnerabilities? Active security maintenance?
- **Platform compatibility** — Does it work with the current stack (Node version, browser targets)?
- **Data compliance** — Does it meet regulatory requirements (GDPR, SOC2, HIPAA)?

### Scored Criteria

| Criterion | Weight | Questions to Ask |
|-----------|--------|-----------------|
| **Maturity** | High | How old is the project? Is it past v1.0? Are breaking changes frequent? |
| **Community & ecosystem** | High | GitHub stars trend, npm downloads, Stack Overflow activity, plugin ecosystem |
| **Documentation quality** | Medium | Are docs comprehensive? Are there examples? Is the API reference complete? |
| **Performance** | Varies | Published benchmarks? Does it meet project requirements? |
| **Developer experience** | Medium | TypeScript support? Good error messages? Debugging tools? |
| **Bundle size** | Medium | What's the gzipped size? Does it support tree-shaking? |
| **Migration path** | Medium | How hard is it to adopt incrementally? What's the exit cost? |
| **Maintenance burden** | High | Frequent breaking changes? Many peer dependencies? Complex configuration? |
| **Team familiarity** | Medium | Does the team already know this? What's the learning curve? |

---

## Trade-Off Analysis Framework

### The Trade-Off Matrix

For each decision, fill out:

```
Option A: [Name]
  Gains: [What you get]
  Costs: [What you give up]
  Risks: [What could go wrong]

Option B: [Name]
  Gains: [What you get]
  Costs: [What you give up]
  Risks: [What could go wrong]
```

### Common Trade-Off Dimensions

| Dimension | Trade-Off |
|-----------|-----------|
| Speed vs. Flexibility | Faster dev now vs. easier changes later |
| Simplicity vs. Power | Less to learn vs. more capabilities |
| Control vs. Convenience | Custom behavior vs. batteries-included |
| Consistency vs. Best-of-breed | One framework vs. specialized tools per concern |
| Build vs. Buy | Full control vs. faster time-to-market |

---

## Common Decision Scenarios

### Database Selection

| Need | Recommendation | Trade-off |
|------|---------------|-----------|
| General purpose, relational | PostgreSQL | Most versatile, but requires schema management |
| Simple key-value or document | Redis / MongoDB | Flexible schema, but no ACID joins |
| Real-time subscriptions | Supabase (Postgres + realtime) | Built-in realtime, vendor coupling |
| Serverless-friendly | PlanetScale / Neon | Auto-scaling, but cold start latency |
| Embedded / local-first | SQLite / Turso | Zero-config, but limited concurrency |

### ORM / Query Builder

| Need | Recommendation | Trade-off |
|------|---------------|-----------|
| Type safety + migrations | Prisma | Great DX, but generated client can be large |
| Lightweight + SQL-like | Drizzle | Smaller bundle, but younger ecosystem |
| Raw SQL with safety | Kysely | Full SQL power, but more verbose |
| Minimal overhead | Direct pg/mysql2 | Zero abstraction cost, but no type safety |

### Authentication

| Need | Recommendation | Trade-off |
|------|---------------|-----------|
| Quick setup, self-hosted | NextAuth (Auth.js) | Free, flexible, but session management is manual |
| Managed + user management UI | Clerk | Polished UX, but vendor lock-in + cost |
| Enterprise SSO needed | Auth0 | Comprehensive, but complex + expensive |
| Open-source full suite | Supabase Auth | Integrated with Supabase, tight coupling |

### State Management

| Need | Recommendation | Trade-off |
|------|---------------|-----------|
| Server state caching | TanStack Query | Best for API data, but learning curve |
| Simple global state | Zustand | Tiny, simple, but no devtools like Redux |
| Complex state + time travel | Redux Toolkit | Powerful, but more boilerplate |
| Form state | React Hook Form | Performant, but API takes time to learn |

### Styling

| Need | Recommendation | Trade-off |
|------|---------------|-----------|
| Utility-first, fast dev | Tailwind CSS | Rapid development, but verbose class names |
| Component library | shadcn/ui + Tailwind | Beautiful defaults, but customization requires Tailwind knowledge |
| CSS-in-JS, colocated styles | CSS Modules | Zero runtime cost, but less dynamic |
| Design system | Radix + Tailwind | Accessible primitives, but assembly required |

### Deployment

| Need | Recommendation | Trade-off |
|------|---------------|-----------|
| Next.js optimized | Vercel | Best DX for Next.js, but vendor lock-in |
| Container-based | Docker + AWS/GCP | Full control, but more infrastructure work |
| Serverless | AWS Lambda + CloudFront | Pay-per-use, but cold starts + complexity |
| Self-hosted | Coolify / Dokku | No vendor fees, but operational burden |
