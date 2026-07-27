# Next.js Patterns Reference

## Table of Contents

1. [App Router Architecture](#app-router-architecture)
2. [Rendering Strategies](#rendering-strategies)
3. [Data Fetching](#data-fetching)
4. [Caching](#caching)
5. [Routing Patterns](#routing-patterns)
6. [Middleware](#middleware)
7. [Optimization](#optimization)

---

## App Router Architecture

### File Conventions

| File | Purpose |
|------|---------|
| `page.tsx` | UI for a route (makes route publicly accessible) |
| `layout.tsx` | Shared UI wrapping children (preserves state across navigations) |
| `loading.tsx` | Suspense fallback for the route segment |
| `error.tsx` | Error boundary for the route segment |
| `not-found.tsx` | 404 UI for the route segment |
| `template.tsx` | Like layout but re-mounts on navigation (no state preservation) |
| `default.tsx` | Fallback for parallel routes |
| `route.tsx` | API endpoint (no UI) |

### Server vs Client Component Decision

```
Default to Server Components. Add 'use client' only when you need:
  ├─ useState, useEffect, useReducer, or other hooks
  ├─ Event handlers (onClick, onChange, onSubmit)
  ├─ Browser APIs (localStorage, window, navigator)
  ├─ Third-party client-side libraries (charts, maps, editors)
  └─ Custom hooks that depend on state/effects
```

**Push `'use client'` as far down as possible.** Only the interactive leaf should be a Client Component.

---

## Rendering Strategies

### Decision Matrix

| Content | Strategy | How |
|---------|----------|-----|
| Static marketing page | **SSG** | No dynamic data, or `generateStaticParams` |
| Blog post | **SSG + ISR** | `revalidate: 3600` (rebuild hourly) |
| User dashboard | **SSR** | `cookies()` or `headers()` makes it dynamic |
| Interactive tool | **Client** | `'use client'` + client-side fetching |
| Product listing (paginated) | **SSR + Streaming** | Suspense boundaries for progressive loading |
| Search results | **Client** | Fast user input → client-side with React Query |

### Static Generation (SSG)
```tsx
// Automatically static if no dynamic functions used
export default async function Page() {
  const data = await fetch('https://api.example.com/posts');
  return <PostList posts={await data.json()} />;
}

// Static with params
export async function generateStaticParams() {
  const posts = await getPosts();
  return posts.map(post => ({ slug: post.slug }));
}
```

### Incremental Static Regeneration (ISR)
```tsx
// Revalidate every 60 seconds
const data = await fetch('https://api.example.com/posts', {
  next: { revalidate: 60 },
});

// Or at the page level
export const revalidate = 60;
```

### Streaming with Suspense
```tsx
export default function Page() {
  return (
    <div>
      <h1>Dashboard</h1>
      <Suspense fallback={<ChartSkeleton />}>
        <SlowChart /> {/* Streams in when ready */}
      </Suspense>
      <Suspense fallback={<TableSkeleton />}>
        <SlowTable /> {/* Streams in independently */}
      </Suspense>
    </div>
  );
}
```

---

## Data Fetching

### Server Components (Preferred)
```tsx
// Direct async in server component — no useEffect, no loading state management
export default async function Page() {
  const posts = await db.post.findMany(); // Direct DB access
  return <PostList posts={posts} />;
}
```

### Server Actions (Mutations)
```tsx
// actions.ts
'use server';

export async function createPost(formData: FormData) {
  const title = formData.get('title') as string;
  await db.post.create({ data: { title } });
  revalidatePath('/posts');
}

// page.tsx (Server Component)
import { createPost } from './actions';

export default function Page() {
  return (
    <form action={createPost}>
      <input name="title" />
      <button type="submit">Create</button>
    </form>
  );
}
```

### Client-Side Fetching (When Needed)
Use React Query / SWR for:
- User-specific data after initial load
- Polling / real-time updates
- Optimistic updates
- Infinite scroll / pagination controlled by user interaction

---

## Caching

### Next.js Cache Layers

```
Request → Router Cache (client, 30s/5min)
           → Full Route Cache (server, static pages)
             → Data Cache (server, fetch results)
               → Origin (DB, API)
```

| Cache | Location | Duration | Opt-Out |
|-------|----------|----------|---------|
| **Request Memoization** | Server, per-request | Single render | N/A |
| **Data Cache** | Server, persistent | Until revalidation | `{ cache: 'no-store' }` |
| **Full Route Cache** | Server, persistent | Until revalidation | Dynamic functions |
| **Router Cache** | Client, in-memory | 30s (dynamic), 5min (static) | `router.refresh()` |

### Revalidation Strategies
```tsx
// Time-based
fetch(url, { next: { revalidate: 60 } });

// On-demand
import { revalidatePath, revalidateTag } from 'next/cache';
revalidatePath('/posts');          // Revalidate a path
revalidateTag('posts');            // Revalidate by tag

// Tag a fetch for on-demand revalidation
fetch(url, { next: { tags: ['posts'] } });
```

---

## Routing Patterns

### Parallel Routes
```
app/
├── @sidebar/
│   └── page.tsx
├── @main/
│   └── page.tsx
└── layout.tsx  ← receives { sidebar, main } as props
```

### Intercepting Routes
```
app/
├── feed/
│   └── page.tsx
├── photo/
│   └── [id]/
│       └── page.tsx
└── @modal/
    └── (.)photo/
        └── [id]/
            └── page.tsx  ← Shows as modal when navigated from feed
```

### Route Groups
```
app/
├── (marketing)/     ← Group (not in URL)
│   ├── layout.tsx   ← Marketing layout
│   ├── about/
│   └── pricing/
├── (app)/           ← Group (not in URL)
│   ├── layout.tsx   ← App layout (with sidebar)
│   ├── dashboard/
│   └── settings/
└── layout.tsx       ← Root layout
```

---

## Middleware

```tsx
// middleware.ts (at project root)
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Auth check
  const token = request.cookies.get('session');
  if (!token && request.nextUrl.pathname.startsWith('/dashboard')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Add headers
  const response = NextResponse.next();
  response.headers.set('x-custom-header', 'value');
  return response;
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/:path*'],
};
```

---

## Optimization

### Image Optimization
```tsx
import Image from 'next/image';

// Always use next/image — automatic lazy loading, WebP, responsive
<Image
  src="/hero.jpg"
  alt="Hero image"
  width={1200}
  height={600}
  priority // Above the fold — disable lazy loading
  sizes="(max-width: 768px) 100vw, 50vw"
/>
```

### Font Optimization
```tsx
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'], display: 'swap' });

export default function Layout({ children }) {
  return <body className={inter.className}>{children}</body>;
}
```

### Metadata & SEO
```tsx
export const metadata: Metadata = {
  title: 'Page Title',
  description: 'Page description',
  openGraph: { title: '...', description: '...', images: ['/og.jpg'] },
};

// Dynamic metadata
export async function generateMetadata({ params }): Promise<Metadata> {
  const post = await getPost(params.slug);
  return { title: post.title, description: post.excerpt };
}
```
