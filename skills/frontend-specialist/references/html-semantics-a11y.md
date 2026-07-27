# HTML Semantics & Accessibility Reference

## Table of Contents

1. [Semantic HTML](#semantic-html)
2. [Accessibility (a11y)](#accessibility)
3. [ARIA](#aria)
4. [Forms](#forms)
5. [HTML5 APIs](#html5-apis)

---

## Semantic HTML

### Document Structure
```html
<header>    <!-- Site/page header (logo, nav) -->
<nav>       <!-- Navigation links -->
<main>      <!-- Primary page content (one per page) -->
<section>   <!-- Thematic grouping of content -->
<article>   <!-- Self-contained content (blog post, comment, card) -->
<aside>     <!-- Tangential content (sidebar, related links) -->
<footer>    <!-- Site/page footer (copyright, links) -->
```

### When to Use What

| Need | Element | NOT |
|------|---------|-----|
| Page header | `<header>` | `<div class="header">` |
| Navigation | `<nav>` | `<div class="nav">` |
| Blog post / card | `<article>` | `<div class="post">` |
| Related content group | `<section>` | `<div class="section">` |
| Sidebar | `<aside>` | `<div class="sidebar">` |
| Clickable action | `<button>` | `<div onClick>` or `<a href="#">` |
| Navigation link | `<a href="/page">` | `<button onClick={navigate}>` |
| List of items | `<ul>` / `<ol>` | Series of `<div>` tags |
| Data table | `<table>` with `<thead>`, `<tbody>` | CSS grid for tabular data |
| Emphasis | `<em>` (semantic) or `<strong>` | `<span class="bold">` |
| Time | `<time datetime="2024-01-15">` | `<span>Jan 15</span>` |

### Heading Rules
- One `<h1>` per page (the page title)
- Don't skip levels (`<h1>` → `<h3>` without `<h2>`)
- Headings create an outline — screen readers navigate by heading
- Use CSS for visual sizing, headings for structure

---

## Accessibility

### WCAG Levels

| Level | Requirement |
|-------|------------|
| **A** | Minimum — basic accessibility (text alternatives, keyboard access) |
| **AA** | Standard target — most legal requirements (contrast, resize, navigation) |
| **AAA** | Enhanced — highest standard (sign language, extended audio description) |

### Essential Accessibility Checklist

**Perceivable:**
- [ ] All images have descriptive `alt` text (decorative images: `alt=""`)
- [ ] Color is not the only way to convey information
- [ ] Text has ≥4.5:1 contrast ratio (3:1 for large text)
- [ ] Content resizes to 200% without loss of functionality
- [ ] Video has captions, audio has transcripts

**Operable:**
- [ ] All functionality accessible via keyboard
- [ ] Visible focus indicators on interactive elements
- [ ] No keyboard traps (user can tab away from any element)
- [ ] Skip-to-content link for screen readers
- [ ] No content that flashes more than 3 times per second

**Understandable:**
- [ ] `lang` attribute on `<html>` element
- [ ] Consistent navigation across pages
- [ ] Error messages are clear and suggest corrections
- [ ] Labels associated with form inputs

**Robust:**
- [ ] Valid HTML (proper nesting, closing tags)
- [ ] ARIA used correctly (or not at all — prefer semantic HTML)
- [ ] Works across screen readers (VoiceOver, NVDA, JAWS)

### Keyboard Navigation

| Key | Expected Behavior |
|-----|------------------|
| `Tab` | Move to next interactive element |
| `Shift+Tab` | Move to previous interactive element |
| `Enter` | Activate button/link |
| `Space` | Activate button, toggle checkbox |
| `Escape` | Close modal/dropdown, cancel action |
| `Arrow keys` | Navigate within widgets (tabs, menus, radio groups) |
| `Home/End` | Jump to first/last item in list |

### Focus Management
```tsx
// Trap focus in modal
import { FocusTrap } from 'focus-trap-react';

<FocusTrap>
  <dialog open>
    <h2>Modal Title</h2>
    <button onClick={close}>Close</button>
  </dialog>
</FocusTrap>

// Move focus on route change
useEffect(() => {
  document.getElementById('main-content')?.focus();
}, [pathname]);

// Skip link
<a href="#main-content" className="sr-only focus:not-sr-only">
  Skip to main content
</a>
```

---

## ARIA

### First Rule of ARIA
**Don't use ARIA if native HTML works.** A `<button>` is always better than `<div role="button">`.

### Common ARIA Attributes

| Attribute | Purpose | Example |
|-----------|---------|---------|
| `aria-label` | Label when no visible text | `<button aria-label="Close">×</button>` |
| `aria-labelledby` | Point to visible label element | `<div aria-labelledby="title-id">` |
| `aria-describedby` | Additional description | `<input aria-describedby="help-text">` |
| `aria-hidden="true"` | Hide from screen readers | Decorative icons |
| `aria-live="polite"` | Announce dynamic content | Toast notifications, status updates |
| `aria-expanded` | Disclosure state | Accordion, dropdown |
| `aria-current="page"` | Current page in navigation | Active nav link |
| `aria-invalid="true"` | Input validation error | Form fields with errors |
| `aria-required="true"` | Required field | Form inputs |
| `role` | Override semantic role | Only when native element isn't available |

### Live Regions (Dynamic Content)
```html
<!-- Announce to screen readers when content changes -->
<div aria-live="polite" aria-atomic="true">
  <!-- Updated content announced after user finishes current task -->
  3 results found
</div>

<div aria-live="assertive">
  <!-- Interrupts to announce immediately -->
  Error: Session expired
</div>
```

### Common Widget Patterns
```html
<!-- Tabs -->
<div role="tablist">
  <button role="tab" aria-selected="true" aria-controls="panel-1">Tab 1</button>
  <button role="tab" aria-selected="false" aria-controls="panel-2">Tab 2</button>
</div>
<div role="tabpanel" id="panel-1">Content 1</div>

<!-- Accordion -->
<h3>
  <button aria-expanded="true" aria-controls="section-1">Section Title</button>
</h3>
<div id="section-1" role="region">Content</div>

<!-- Dialog (prefer native <dialog>) -->
<dialog open aria-labelledby="dialog-title" aria-modal="true">
  <h2 id="dialog-title">Confirm Delete</h2>
  <!-- ... -->
</dialog>
```

---

## Forms

### Accessible Form Pattern
```html
<form>
  <div>
    <label for="email">Email address</label>
    <input
      id="email"
      type="email"
      name="email"
      required
      aria-describedby="email-help email-error"
      aria-invalid="false"
    />
    <p id="email-help">We'll never share your email.</p>
    <p id="email-error" role="alert" hidden>Please enter a valid email.</p>
  </div>

  <fieldset>
    <legend>Notification preferences</legend>
    <label><input type="checkbox" name="email-notify" /> Email</label>
    <label><input type="checkbox" name="sms-notify" /> SMS</label>
  </fieldset>

  <button type="submit">Subscribe</button>
</form>
```

### Input Type Selection

| Data | Input Type | Why |
|------|-----------|-----|
| Email | `type="email"` | Validates, shows @ keyboard on mobile |
| Phone | `type="tel"` | Numeric keyboard on mobile |
| URL | `type="url"` | Validates URL format |
| Number | `type="number"` | Numeric keyboard, min/max/step |
| Date | `type="date"` | Native date picker |
| Search | `type="search"` | Clear button, screen reader announces |
| Password | `type="password"` | Masked input |

---

## HTML5 APIs

### Commonly Used

| API | Purpose | Example |
|-----|---------|---------|
| `<dialog>` | Native modal/dialog | `dialog.showModal()` / `dialog.close()` |
| `<details>/<summary>` | Native accordion | No JS needed for basic disclosure |
| `<picture>` + `<source>` | Responsive images, art direction | WebP with JPEG fallback |
| `loading="lazy"` | Native lazy loading | Images and iframes |
| `fetchpriority="high"` | Hint resource priority | Above-the-fold images |
| `<template>` | Inert HTML template | Clone into DOM when needed |
| `popover` attribute | Native popover/tooltip | `<div popover>` + `popovertarget` |
| `inert` attribute | Disable interaction | Mark background content behind modals |

### `<dialog>` (Prefer Over Custom Modals)
```html
<dialog id="confirm-dialog">
  <h2>Are you sure?</h2>
  <form method="dialog">
    <button value="cancel">Cancel</button>
    <button value="confirm">Confirm</button>
  </form>
</dialog>

<script>
  dialog.showModal();  // Opens with backdrop, focus trap, Escape to close
  dialog.addEventListener('close', () => {
    console.log(dialog.returnValue); // 'cancel' or 'confirm'
  });
</script>
```

### Popover API (Native Tooltips/Dropdowns)
```html
<button popovertarget="menu">Open Menu</button>
<div id="menu" popover>
  <a href="/settings">Settings</a>
  <a href="/logout">Logout</a>
</div>
<!-- Auto: closes on click outside. Manual: must close programmatically -->
```
