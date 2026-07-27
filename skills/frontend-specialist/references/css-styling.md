# CSS & Styling Reference

## Table of Contents

1. [Layout Systems](#layout-systems)
2. [Responsive Design](#responsive-design)
3. [CSS Architecture](#css-architecture)
4. [SCSS Patterns](#scss-patterns)
5. [Animations & Transitions](#animations--transitions)
6. [Modern CSS Features](#modern-css-features)
7. [Tailwind CSS Patterns](#tailwind-css-patterns)

---

## Layout Systems

### Flexbox (1D Layout)

```css
/* Centering (most common use) */
.center {
  display: flex;
  justify-content: center; /* main axis */
  align-items: center;     /* cross axis */
}

/* Space between items */
.nav { display: flex; justify-content: space-between; align-items: center; }

/* Wrap with gap */
.tags { display: flex; flex-wrap: wrap; gap: 8px; }

/* Fill remaining space */
.sidebar { flex: 0 0 250px; }  /* fixed */
.content { flex: 1; }          /* grows to fill */
```

### Grid (2D Layout)

```css
/* Basic grid */
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }

/* Responsive auto-fill */
.auto-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 24px;
}

/* Named areas */
.layout {
  display: grid;
  grid-template-areas:
    "header header"
    "sidebar main"
    "footer footer";
  grid-template-columns: 250px 1fr;
  grid-template-rows: auto 1fr auto;
}
.header  { grid-area: header; }
.sidebar { grid-area: sidebar; }
.main    { grid-area: main; }
```

### When to Use What

| Layout Need | Use |
|------------|-----|
| Single row/column of items | Flexbox |
| Centering | Flexbox |
| Equal-height cards in a row | Flexbox or Grid |
| Complex 2D layout | Grid |
| Responsive card grid | Grid with `auto-fill`/`auto-fit` |
| Full page layout (header, sidebar, content) | Grid with named areas |
| Unknown number of items wrapping | Flexbox with `wrap` |

---

## Responsive Design

### Mobile-First Approach
```css
/* Base styles = mobile */
.card { padding: 16px; }

/* Scale up for larger screens */
@media (min-width: 768px) { .card { padding: 24px; } }
@media (min-width: 1024px) { .card { padding: 32px; } }
```

### Breakpoint System
```css
/* Standard breakpoints */
--mobile: 480px;
--tablet: 768px;
--desktop: 1024px;
--wide: 1280px;
--ultrawide: 1536px;
```

### Container Queries (Modern)
```css
.card-container { container-type: inline-size; }

@container (min-width: 400px) {
  .card { flex-direction: row; }
}
```

### Fluid Typography
```css
/* Clamp: min, preferred, max */
h1 { font-size: clamp(1.5rem, 4vw, 3rem); }
p  { font-size: clamp(1rem, 2vw, 1.25rem); }
```

### Responsive Images
```css
img { max-width: 100%; height: auto; } /* Basic responsive */

/* Art direction with picture */
```
```html
<picture>
  <source media="(min-width: 1024px)" srcset="hero-wide.webp" />
  <source media="(min-width: 768px)" srcset="hero-medium.webp" />
  <img src="hero-small.webp" alt="Hero" />
</picture>
```

---

## CSS Architecture

### BEM (Block Element Modifier)
```css
.card {}              /* Block */
.card__title {}       /* Element */
.card__title--large {} /* Modifier */
.card--featured {}    /* Block modifier */
```

### CSS Modules (Recommended for React)
```tsx
import styles from './Button.module.css';
<button className={styles.primary}>Click</button>
// Generates: .Button_primary_x7d2
```

### CSS Custom Properties (Design Tokens)
```css
:root {
  /* Colors */
  --color-primary: #3b82f6;
  --color-primary-hover: #2563eb;
  --color-text: #1f2937;
  --color-text-secondary: #6b7280;
  --color-bg: #ffffff;
  --color-bg-secondary: #f9fafb;
  --color-border: #e5e7eb;

  /* Spacing */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;

  /* Typography */
  --font-sans: 'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.125rem;

  /* Borders & Shadows */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
  --shadow-md: 0 4px 6px rgba(0,0,0,0.07);
}

/* Dark mode */
@media (prefers-color-scheme: dark) {
  :root {
    --color-text: #f9fafb;
    --color-bg: #111827;
    --color-border: #374151;
  }
}
```

### Styling Approach Selection

| Approach | Best For | Trade-off |
|----------|---------|-----------|
| Tailwind CSS | Rapid development, design systems | Verbose class names |
| CSS Modules | Component scoping, no runtime cost | Requires build step |
| styled-components/emotion | Dynamic styles, theming | Runtime cost |
| Vanilla CSS + custom properties | Simple projects, performance | Manual scoping |
| SCSS | Complex projects, mixins, nesting | Build step, can get messy |

---

## SCSS Patterns

### Useful Mixins
```scss
// Responsive breakpoint
@mixin breakpoint($size) {
  @if $size == tablet { @media (min-width: 768px) { @content; } }
  @if $size == desktop { @media (min-width: 1024px) { @content; } }
}

// Truncate text
@mixin truncate($lines: 1) {
  @if $lines == 1 {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  } @else {
    display: -webkit-box; -webkit-line-clamp: $lines;
    -webkit-box-orient: vertical; overflow: hidden;
  }
}

// Visually hidden (accessible)
@mixin sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0;
  margin: -1px; overflow: hidden; clip: rect(0,0,0,0);
  white-space: nowrap; border: 0;
}
```

### SCSS Best Practices
- Max nesting depth: 3 levels
- Use `@use` and `@forward` instead of `@import` (deprecated)
- Keep mixins in a separate `_mixins.scss` partial
- Use variables for design tokens, custom properties for runtime theming
- Avoid `@extend` — prefer mixins (extend creates unexpected selector bloat)

---

## Animations & Transitions

### Performance-Safe Properties
Only animate properties that skip layout/paint:
- `transform` (translate, rotate, scale)
- `opacity`
- `filter`

```css
/* GOOD: GPU-accelerated */
.card:hover { transform: translateY(-4px); opacity: 0.9; }

/* BAD: Triggers layout recalculation */
.card:hover { top: -4px; width: 110%; }
```

### Transition Patterns
```css
/* Smooth hover */
.button {
  transition: background-color 150ms ease, transform 150ms ease;
}
.button:hover { background-color: var(--color-primary-hover); }
.button:active { transform: scale(0.98); }

/* Entrance animation */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.card { animation: fadeIn 300ms ease-out; }
```

### Reduced Motion
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Modern CSS Features

### `:has()` (Parent Selector)
```css
/* Style parent based on child state */
.form-group:has(input:invalid) { border-color: red; }
.card:has(img) { padding-top: 0; }
```

### Nesting (Native CSS)
```css
.card {
  padding: 16px;

  & .title { font-size: 1.25rem; }
  &:hover { box-shadow: var(--shadow-md); }
  @media (min-width: 768px) { padding: 24px; }
}
```

### `color-mix()`
```css
.button:hover {
  background: color-mix(in srgb, var(--color-primary), black 15%);
}
```

### Scroll Snap
```css
.carousel { scroll-snap-type: x mandatory; overflow-x: scroll; }
.carousel > * { scroll-snap-align: start; }
```

### Logical Properties
```css
/* Use instead of left/right for RTL support */
.sidebar { margin-inline-end: 24px; } /* instead of margin-right */
.heading { padding-block: 16px; }     /* instead of padding-top/bottom */
```

---

## Tailwind CSS Patterns

### Component Patterns
```tsx
// Consistent spacing and responsive
<div className="flex flex-col gap-4 p-4 md:flex-row md:gap-6 md:p-6">

// Card pattern
<div className="rounded-lg border bg-white p-6 shadow-sm dark:bg-gray-900">

// Responsive grid
<div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">

// Truncated text
<p className="truncate">Long text...</p>
<p className="line-clamp-2">Multi-line truncation...</p>
```

### Custom Design Tokens in Tailwind
```javascript
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: { 50: '#eff6ff', 500: '#3b82f6', 700: '#1d4ed8' },
      },
      spacing: { '18': '4.5rem' },
      animation: { 'fade-in': 'fadeIn 300ms ease-out' },
    },
  },
};
```
