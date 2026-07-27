# Technical Design Document: [Feature/System Name]

**Author:** [Name]
**Date:** [YYYY-MM-DD]
**Status:** [Draft | In Review | Approved]
**Reviewers:** [Names]

---

## 1. Overview

### Problem Statement
[What problem does this solve? Who is affected? What is the impact?]

### Goals
- [Primary goal]
- [Secondary goal]

### Non-Goals
- [Explicitly out of scope]

---

## 2. Proposed Solution

### High-Level Architecture
[Describe the approach. Include a diagram if helpful (ASCII or mermaid).]

```
[Component diagram or data flow]
```

### Key Design Decisions
1. **[Decision]:** [Rationale]
2. **[Decision]:** [Rationale]

---

## 3. Detailed Design

### Data Model
[Database schema changes, new tables/collections, relationships]

```sql
-- Example schema changes
```

### API Design
[New or modified endpoints, request/response contracts]

```
[METHOD] /api/[resource]
Request: { ... }
Response: { ... }
```

### Component Architecture
[Key components, their responsibilities, and interactions]

### State Management
[How state flows through the system, caching strategy]

---

## 4. Implementation Plan

### Phases
1. **Phase 1:** [Description] — [Estimated scope]
2. **Phase 2:** [Description] — [Estimated scope]

### Migration Strategy
[If applicable: how to migrate existing data/users, rollback plan]

---

## 5. Trade-Offs & Alternatives

### Chosen Approach
[Why this solution over alternatives]

### Alternatives Considered
| Alternative | Why Not |
|------------|---------|
| [Option] | [Reason] |

---

## 6. Operational Considerations

### Performance
[Expected load, bottlenecks, optimization strategies]

### Security
[Authentication, authorization, data protection, input validation]

### Monitoring & Observability
[Key metrics, logging, alerting]

### Rollback Plan
[How to revert if something goes wrong]

---

## 7. Testing Strategy

| Test Type | Scope | Tool |
|-----------|-------|------|
| Unit | [What to test] | [Tool] |
| Integration | [What to test] | [Tool] |
| E2E | [What to test] | [Tool] |

---

## 8. Open Questions
- [ ] [Question 1]
- [ ] [Question 2]
