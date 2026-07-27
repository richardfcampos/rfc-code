# Performance & SEO Reference

## Table of Contents

1. [Core Web Vitals](#core-web-vitals)
2. [Rendering Performance](#rendering-performance)
3. [Bundle Optimization](#bundle-optimization)
4. [Image Optimization](#image-optimization)
5. [Technical SEO](#technical-seo)
6. [Content SEO](#content-seo)
7. [Structured Data](#structured-data)

---

## Core Web Vitals

| Metric | Good | Needs Improvement | Poor | What It Measures |
|--------|------|-------------------|------|-----------------|
| **LCP** (Largest Contentful Paint) | ≤2.5s | 2.5-4s | >4s | Loading — when main content appears |
| **INP** (Interaction to Next Paint) | ≤200ms | 200-500ms | >500ms | Responsiveness — delay after user interacts |
| **CLS** (Cumulative Layout Shift) | ≤0.1 | 0.1-0.25 | >0.25 | Stability — unexpected layout movement |

### Fix LCP
1. Optimize the LCP element (usually hero image or heading)
2. `<link rel="preload">` for hero image
3. Use `priority` prop in Next.js `<Image>`
4. Inline critical CSS, defer non-critical
5. Reduce server response time (SSR, CDN)
6. Avoid render-blocking JavaScript

### Fix INP
1. Break up long tasks (>50ms) with `requestIdleCallback` or `scheduler.yield()`
2. Reduce JavaScript on main thread
3. Debounce expensive event handlers
4. Use `startTransition` for non-urgent updates
5. Offload heavy computation to Web Workers

### Fix CLS
1. Always set `width` and `height` on images/videos
2. Reserve space for dynamic content (skeleton screens)
3. Avoid inserting content above existing content
4. Use `font-display: swap` with size-adjust for web fonts
5. Use CSS `aspect-ratio` for responsive media

---

## Rendering Performance

### React Rendering Optimization

| Problem | Solution |
|---------|---------|
| Entire tree re-renders | Move state down, use composition pattern |
| Expensive component re-renders on every parent render | `React.memo` with stable props |
| New object/array on every render | `useMemo` for derived data |
| New function reference on every render | `useCallback` for callbacks passed to memoized children |
| Large list rendering | Virtualization (`@tanstack/react-virtual`) |
| Slow initial render | Code splitting + `Suspense` |
| Layout thrashing | Batch DOM reads/writes, use `useLayoutEffect` sparingly |

### Avoiding Layout Thrashing
```javascript
// BAD: Read-write-read-write (forces multiple layouts)
elements.forEach(el => {
  const height = el.offsetHeight;    // Read (forces layout)
  el.style.height = height + 10 + 'px'; // Write (invalidates layout)
});

// GOOD: Batch reads then batch writes
const heights = elements.map(el => el.offsetHeight); // Read all
elements.forEach((el, i) => {
  el.style.height = heights[i] + 10 + 'px'; // Write all
});
```

---

## Bundle Optimization

### Analysis
```bash
# Next.js
ANALYZE=true next build  # with @next/bundle-analyzer

# Vite
npx vite-bundle-visualizer

# General
npx source-map-explorer build/static/js/*.js
```

### Reduction Strategies

| Strategy | Impact |
|----------|--------|
| Tree-shaking (ESM imports) | Remove unused code from dependencies |
| Code splitting (dynamic imports) | Load code only when needed |
| Lazy loading routes | Each route loads its own bundle |
| Replace heavy libraries | `dayjs` (2KB) instead of `moment` (72KB) |
| Use native APIs | `fetch`, `structuredClone`, `crypto.randomUUID` |
| Externalize large deps | Load from CDN or separate chunk |
| Compression (gzip/brotli) | 60-80% smaller transfer size |

### Import Cost Awareness

| Import | Bundle Impact |
|--------|--------------|
| `import _ from 'lodash'` | 72KB (entire library!) |
| `import { debounce } from 'lodash-es'` | ~1KB (tree-shaken) |
| `import moment from 'moment'` | 72KB (use `dayjs`) |
| `import { format } from 'date-fns'` | ~2KB (tree-shaken) |
| `import axios from 'axios'` | 13KB (use native `fetch`) |

---

## Image Optimization

### Format Selection

| Format | Use For | Browser Support |
|--------|---------|----------------|
| **WebP** | Photos, complex images (default choice) | All modern browsers |
| **AVIF** | Best compression, quality | Growing (Chrome, Firefox) |
| **SVG** | Icons, logos, illustrations | Universal |
| **PNG** | Transparency needed, screenshots | Universal |
| **JPEG** | Fallback for photos | Universal |

### Optimization Checklist
- [ ] Use `next/image` or `<picture>` with multiple sources
- [ ] Serve responsive sizes (`srcset` + `sizes`)
- [ ] Lazy load below-the-fold images (`loading="lazy"`)
- [ ] Eager load above-the-fold images (`priority` / `fetchpriority="high"`)
- [ ] Set explicit `width` and `height` (prevents CLS)
- [ ] Use `aspect-ratio` CSS for responsive sizing
- [ ] Serve from CDN with caching headers
- [ ] Compress: JPEG at 75-85 quality, WebP at 80

---

## Technical SEO

### Essential Tags
```html
<head>
  <title>Primary Keyword - Brand Name</title> <!-- 50-60 chars -->
  <meta name="description" content="Compelling description with keywords" /> <!-- 150-160 chars -->
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="canonical" href="https://example.com/page" />

  <!-- Open Graph -->
  <meta property="og:title" content="Title for social sharing" />
  <meta property="og:description" content="Description for social" />
  <meta property="og:image" content="https://example.com/og-image.jpg" /> <!-- 1200x630 -->
  <meta property="og:url" content="https://example.com/page" />
  <meta property="og:type" content="website" />

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
</head>
```

### Technical SEO Checklist
- [ ] SSL/HTTPS on all pages
- [ ] Canonical URLs set (prevent duplicate content)
- [ ] sitemap.xml generated and submitted
- [ ] robots.txt configured
- [ ] Proper heading hierarchy (single H1, logical H2-H6)
- [ ] Descriptive `alt` text on all images
- [ ] Clean URL structure (readable, no query params for content)
- [ ] 301 redirects for moved/deleted pages
- [ ] Mobile-friendly (responsive design)
- [ ] Fast loading (Core Web Vitals passing)
- [ ] No broken links (404s)
- [ ] Proper internationalization (hreflang tags if multi-language)

### Next.js SEO
```tsx
// Static metadata
export const metadata: Metadata = {
  title: { default: 'Site Name', template: '%s | Site Name' },
  description: 'Site description',
  robots: { index: true, follow: true },
  openGraph: { /* ... */ },
};

// Dynamic metadata
export async function generateMetadata({ params }): Promise<Metadata> {
  const page = await getPage(params.slug);
  return { title: page.title, description: page.description };
}

// Sitemap
// app/sitemap.ts
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await getPosts();
  return posts.map(post => ({
    url: `https://example.com/posts/${post.slug}`,
    lastModified: post.updatedAt,
    changeFrequency: 'weekly',
    priority: 0.8,
  }));
}
```

---

## Content SEO

### Heading Structure
```html
<h1>Primary Topic (one per page)</h1>
  <h2>Major Section</h2>
    <h3>Subsection</h3>
  <h2>Another Section</h2>
    <h3>Subsection</h3>
```

### Content Guidelines
- **Title tag**: Primary keyword near the beginning, under 60 characters
- **Meta description**: Compelling summary with CTA, 150-160 characters
- **URL slug**: Short, readable, includes keyword (`/blog/react-performance-tips`)
- **Internal linking**: Link to related content naturally
- **Image alt text**: Descriptive, include keywords naturally
- **First paragraph**: Include primary keyword within first 100 words

---

## Structured Data

### JSON-LD Patterns (Most Common)

```html
<!-- Organization -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Company Name",
  "url": "https://example.com",
  "logo": "https://example.com/logo.png"
}
</script>

<!-- Article/Blog Post -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Article Title",
  "author": { "@type": "Person", "name": "Author" },
  "datePublished": "2024-01-15",
  "image": "https://example.com/image.jpg"
}
</script>

<!-- FAQ (rich snippet in search results) -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [{
    "@type": "Question",
    "name": "What is React?",
    "acceptedAnswer": { "@type": "Answer", "text": "React is..." }
  }]
}
</script>
```
