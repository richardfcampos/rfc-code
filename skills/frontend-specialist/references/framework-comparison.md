# Framework Comparison & Micro-Frontends

## Table of Contents

1. [React vs Vue vs Angular](#react-vs-vue-vs-angular)
2. [When to Choose Each](#when-to-choose-each)
3. [Meta-Frameworks](#meta-frameworks)
4. [Micro-Frontends](#micro-frontends)

---

## React vs Vue vs Angular

| Feature | React | Vue | Angular |
|---------|-------|-----|---------|
| **Type** | Library (UI only) | Progressive framework | Full framework |
| **Language** | JSX + TypeScript | Templates + TypeScript/JS | Templates + TypeScript (required) |
| **State management** | External (Context, Zustand, Redux) | Built-in (ref, reactive, Pinia) | Built-in (Services, RxJS, Signals) |
| **Routing** | External (React Router, Next.js) | Vue Router (official) | Built-in (@angular/router) |
| **Learning curve** | Medium (flexible = more decisions) | Low (batteries included, gradual) | High (full framework, many concepts) |
| **Bundle size (min)** | ~40KB (React + ReactDOM) | ~33KB (Vue 3) | ~130KB (Angular core) |
| **Reactivity** | Re-render entire subtree, manual memo | Fine-grained (proxy-based, auto-tracking) | Zone.js (legacy) or Signals (modern) |
| **Ecosystem size** | Largest | Large, growing | Large, enterprise-focused |
| **Enterprise adoption** | Very high | High (growing) | Very high (enterprise standard) |
| **Mobile** | React Native | Capacitor, NativeScript | Ionic, NativeScript |

### Reactivity Model Comparison

**React:** Pull-based. Component re-renders when state changes. All children re-render unless memoized.
```tsx
const [count, setCount] = useState(0);
// Setting state re-renders this component and ALL children
```

**Vue:** Push-based. Fine-grained reactivity tracks dependencies automatically. Only dependent components update.
```vue
<script setup>
const count = ref(0);
// Only components reading `count` re-render — automatic dependency tracking
</script>
```

**Angular (Signals):** Push-based. Signals notify consumers of changes.
```typescript
count = signal(0);
doubleCount = computed(() => this.count() * 2);
// Only templates reading count() or doubleCount() update
```

---

## When to Choose Each

### Choose React When
- Building a complex SPA or dashboard
- Need the largest ecosystem of libraries and tools
- Team has React experience
- Want flexibility in architecture decisions
- Planning to use React Native for mobile
- Using Next.js for the meta-framework

### Choose Vue When
- Want fastest time-to-productivity
- Smaller team, need conventions over configuration
- Transitioning from jQuery/vanilla JS (gradual adoption)
- Prefer template syntax over JSX
- Using Nuxt for the meta-framework
- Value fine-grained reactivity without manual optimization

### Choose Angular When
- Enterprise application with large team
- Need opinionated structure (consistency across teams)
- Heavy use of dependency injection patterns
- Team has Java/C# background (similar patterns)
- RxJS-heavy reactive programming needs
- Need built-in forms, HTTP client, routing, i18n

### Avoid Framework Lock-in
- Use Web Components for truly shared components across frameworks
- Use framework-agnostic state libraries (Signals proposal, TanStack)
- Keep business logic in plain TypeScript, separate from framework code
- Use standard Web APIs where possible

---

## Meta-Frameworks

| Feature | Next.js (React) | Nuxt (Vue) | SvelteKit (Svelte) | Analog (Angular) |
|---------|-----------------|------------|--------------------|--------------------|
| SSR | Yes | Yes | Yes | Yes |
| SSG | Yes | Yes | Yes | Yes |
| ISR | Yes | Yes (with Nitro) | Partial | Partial |
| Server Components | Yes (RSC) | Upcoming | No | No |
| File-based routing | Yes | Yes | Yes | Yes |
| API routes | Yes | Yes (Nitro) | Yes | Yes |
| Edge runtime | Yes | Yes | Yes | Partial |
| Maturity | Highest | High | Growing | Early |

---

## Micro-Frontends

### What Are Micro-Frontends?
Independent frontend applications composed into a single user experience. Each micro-frontend can use different frameworks, be deployed independently, and be owned by different teams.

### When to Use
- Multiple teams working on different features of a large app
- Need independent deployment per feature
- Gradual migration from one framework to another
- Different parts of the app have vastly different requirements

### When NOT to Use
- Small team (<10 engineers)
- Simple application
- Teams can coordinate easily
- Consistency is more important than independence

### Implementation Approaches

| Approach | How It Works | Trade-off |
|----------|-------------|-----------|
| **Module Federation** (Webpack 5) | Runtime sharing of JS modules between apps | Most flexible, complex setup |
| **Single-SPA** | Framework-agnostic orchestrator | Multi-framework support, learning curve |
| **iframe** | Isolated apps in iframes | Complete isolation, poor UX/performance |
| **Web Components** | Custom elements wrapping framework components | Universal, performance overhead |
| **Build-time composition** | NPM packages combined at build | Simplest, not independently deployable |
| **Edge-side composition** | Server composes HTML fragments | Good performance, infrastructure complexity |

### Module Federation Pattern

```javascript
// Remote app (exposes components)
// webpack.config.js
new ModuleFederationPlugin({
  name: 'payments',
  filename: 'remoteEntry.js',
  exposes: {
    './PaymentForm': './src/components/PaymentForm',
  },
  shared: { react: { singleton: true }, 'react-dom': { singleton: true } },
});

// Host app (consumes remote components)
new ModuleFederationPlugin({
  name: 'shell',
  remotes: {
    payments: 'payments@https://payments.example.com/remoteEntry.js',
  },
  shared: { react: { singleton: true }, 'react-dom': { singleton: true } },
});

// Usage in host
const PaymentForm = lazy(() => import('payments/PaymentForm'));
```

### Micro-Frontend Best Practices
- **Share a design system** — Consistent UI despite independent teams
- **Shared dependencies** — React, React DOM as singletons to avoid duplication
- **Independent data stores** — Each micro-frontend owns its state
- **Event-based communication** — CustomEvents or shared event bus between micro-frontends
- **Shared authentication** — Single auth flow, pass tokens to micro-frontends
- **Consistent routing** — One router owns the URL, micro-frontends handle sub-routes
- **Performance budgets** — Set bundle size limits per micro-frontend
