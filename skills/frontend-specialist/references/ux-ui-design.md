# UX/UI Design Reference

## Table of Contents

1. [Design Principles](#design-principles)
2. [Usability Heuristics](#usability-heuristics)
3. [UI Patterns](#ui-patterns)
4. [Mobile Design](#mobile-design)
5. [Design System Foundations](#design-system-foundations)
6. [User Psychology](#user-psychology)
7. [Design Process](#design-process)

---

## Design Principles

### Core Principles

| Principle | Rule | Example |
|-----------|------|---------|
| **Hierarchy** | Most important content is most prominent | Large heading, bold CTA, muted secondary text |
| **Consistency** | Same actions look and behave the same | All primary buttons share color, size, padding |
| **Proximity** | Related items are grouped together | Form labels close to their inputs |
| **Contrast** | Important elements stand out | CTA button contrasts with background (4.5:1 min) |
| **Whitespace** | Breathing room improves readability | Generous padding, margins between sections |
| **Feedback** | Every action has a visible response | Button states, loading indicators, success messages |
| **Simplicity** | Remove everything unnecessary | One CTA per section, progressive disclosure |

### Visual Hierarchy Techniques
1. **Size** — Larger = more important
2. **Color/Contrast** — High contrast draws attention
3. **Weight** — Bold vs regular text
4. **Position** — Top-left (F-pattern) gets seen first
5. **Spacing** — Isolated elements draw attention
6. **Depth** — Shadows/elevation suggest importance

---

## Usability Heuristics (Nielsen's 10)

| # | Heuristic | Implementation |
|---|-----------|---------------|
| 1 | **Visibility of system status** | Loading spinners, progress bars, save confirmations, active nav states |
| 2 | **Match real world** | Use language users know, not internal jargon. Calendar icons for dates. |
| 3 | **User control & freedom** | Undo/redo, cancel buttons, back navigation, clear form reset |
| 4 | **Consistency & standards** | Follow platform conventions (underline = link, × = close) |
| 5 | **Error prevention** | Disable invalid actions, confirmation for destructive ops, inline validation |
| 6 | **Recognition over recall** | Show options (dropdown), recent items, breadcrumbs, visible navigation |
| 7 | **Flexibility & efficiency** | Keyboard shortcuts for power users, search, recently used items |
| 8 | **Aesthetic & minimal design** | Remove decorative elements that don't serve function |
| 9 | **Help users recognize & recover from errors** | Clear error messages with solutions, not codes |
| 10 | **Help & documentation** | Tooltips, onboarding tours, contextual help, searchable docs |

---

## UI Patterns

### Navigation Patterns

| Pattern | Best For | Example |
|---------|---------|---------|
| Top navigation bar | Websites, <7 items | Marketing sites, SaaS headers |
| Side navigation | Apps, many sections | Admin dashboards, settings |
| Bottom tab bar | Mobile apps, 3-5 main sections | iOS/Android apps |
| Breadcrumbs | Deep hierarchies | E-commerce categories, docs |
| Command palette | Power users, many actions | VS Code (Cmd+Shift+P), Linear |

### Form Design Rules

1. **Single column layout** — Users scan top-to-bottom, not zigzag
2. **Labels above inputs** — Faster to scan than left-aligned labels
3. **Group related fields** — Name fields together, address fields together
4. **Inline validation** — Validate on blur (not on every keystroke)
5. **Clear error messages** — "Email must include @" not "Invalid input"
6. **Reduce fields** — Every field reduces completion rate ~5%
7. **Smart defaults** — Pre-fill country from locale, suggest common values
8. **Primary action prominent** — "Save" is primary (filled), "Cancel" is secondary (outlined)

### Modal/Dialog Rules
- Use for focused tasks that require immediate attention
- Always include a close button and Escape key handler
- Dim/blur the background
- Keep content minimal — if complex, use a full page instead
- Don't nest modals
- Trap focus inside the modal (a11y)

### Loading States
```
Initial load → Skeleton screens (not spinners)
Action pending → Inline spinner near the action button
Background save → Subtle indicator (toast, checkmark)
Long operation → Progress bar with percentage
```

### Empty States
Show helpful content when no data exists:
- Illustration or icon
- Explanation of what would appear here
- CTA to create the first item

### Toast/Notification Rules
- Position: top-right (desktop), top-center (mobile)
- Auto-dismiss: 3-5 seconds for success, manual dismiss for errors
- Max 3 toasts visible simultaneously
- Include action link when relevant ("Undo")

---

## Mobile Design

### Touch Targets
- Minimum tap target: **44×44px** (Apple), **48×48dp** (Google)
- Minimum spacing between targets: **8px**
- Place primary actions within thumb reach (bottom of screen)

### Mobile Patterns
- **Bottom sheet** over modal for mobile actions
- **Pull-to-refresh** for list refreshing
- **Swipe actions** for list item operations (delete, archive)
- **Sticky header** that collapses on scroll
- **Floating action button (FAB)** for primary creation action

### Mobile-First Design Rules
1. Design for smallest screen first, then enhance
2. One primary action per screen
3. Large touch targets, generous spacing
4. Avoid hover-dependent interactions
5. Use native input types (tel, email, number) for correct keyboard
6. Consider thumb zones — important actions at bottom

---

## Design System Foundations

### Typography Scale
```
xs:  12px / 0.75rem  — Captions, labels
sm:  14px / 0.875rem — Secondary text, metadata
base: 16px / 1rem    — Body text (default)
lg:  18px / 1.125rem — Subheadings, emphasis
xl:  20px / 1.25rem  — Section titles
2xl: 24px / 1.5rem   — Page subtitles
3xl: 30px / 1.875rem — Page titles
4xl: 36px / 2.25rem  — Hero headings
```

**Rules:** Max 2 font families. Line height: 1.5 for body, 1.2 for headings. Max line width: 65-75 characters.

### Color System
```
Primary:   Brand color (buttons, links, active states)
Secondary: Supporting color (tags, badges)
Neutral:   Gray scale (text, borders, backgrounds)
Success:   Green (confirmations, positive states)
Warning:   Yellow/amber (caution, pending states)
Error:     Red (errors, destructive actions)
Info:      Blue (informational messages)
```

**Contrast ratios:** WCAG AA minimum — 4.5:1 for normal text, 3:1 for large text.

### Spacing System (8px Grid)
```
4px  — Tight: between icon and label
8px  — Compact: within components
16px — Standard: between related elements
24px — Comfortable: between sections
32px — Spacious: between major sections
48px — Section: page-level separation
```

### Elevation/Shadow System
```
Level 0: flat (cards, containers)
Level 1: subtle shadow (raised cards, dropdowns)
Level 2: medium shadow (modals, popovers)
Level 3: strong shadow (floating elements, notifications)
```

---

## User Psychology

### Cognitive Load
- **Miller's Law**: Users can hold ~7 items in working memory. Limit navigation, form fields, and options.
- **Hick's Law**: Decision time increases with the number of choices. Reduce options or use progressive disclosure.
- **Fitts's Law**: Larger, closer targets are easier to click. Make CTAs large and accessible.

### Persuasion Patterns
- **Social proof**: "10,000+ companies use this", user testimonials
- **Scarcity**: "3 spots left", "Offer ends tomorrow"
- **Default effect**: Pre-select the recommended option (opt-out > opt-in)
- **Anchoring**: Show higher price first (crossed out), then discounted price
- **Loss aversion**: "Don't lose your progress" > "Save your progress"

### Reading Patterns
- **F-pattern**: Users scan in F-shape on text-heavy pages (top, then left side)
- **Z-pattern**: Users scan in Z on minimal/landing pages (top-left → top-right → bottom-left → bottom-right)
- **Place key content on the scan path**: Headlines, CTAs, important info

---

## Design Process

### Design-to-Code Workflow

1. **Wireframe**: Low-fidelity layout (pen/paper or Excalidraw)
2. **Design tokens**: Define colors, typography, spacing in code
3. **Component inventory**: List all unique components needed
4. **Build atomic components**: Buttons, inputs, badges, cards
5. **Compose pages**: Assemble components into page layouts
6. **Responsive testing**: Check all breakpoints
7. **Accessibility audit**: Screen reader, keyboard, contrast

### Design Review Checklist
- [ ] Visual hierarchy clear (user knows where to look)
- [ ] Consistent spacing and alignment
- [ ] All interactive elements have hover/focus/active states
- [ ] Error states and empty states designed
- [ ] Loading states designed (skeletons, spinners)
- [ ] Responsive across breakpoints
- [ ] Contrast meets WCAG AA (4.5:1)
- [ ] Touch targets ≥ 44px on mobile
- [ ] Accessible (keyboard navigable, screen reader friendly)
