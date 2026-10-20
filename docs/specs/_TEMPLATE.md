# Spec: <Screen name>

| | |
|---|---|
| **Release** | 0 / 1 / 2 … |
| **Route** | `/app/...` (Next.js App Router path) |
| **Mockup** | `mockup/<File>.dc.html` |
| **Status** | Draft · Reviewed by Blake · Built · Verified at TMG |

## Purpose
One or two sentences: who uses this screen and what job it does.

## Who can see it
| Role | Access |
|---|---|
| Owner | |
| Admin | |
| Project manager | |
| Staff | |
| Client (portal) | none unless stated |

## Layout
Top-to-bottom description of the regions on the page, matching the mockup. Name the shared components used (see `docs/DESIGN_SYSTEM.md`).

## Data shown
| UI element | Source (table.column or calculation) | Notes / format |
|---|---|---|

## Actions
| Action | What happens | Validation | Permission |
|---|---|---|---|

## Business rules
Numbered list. Every calculation written out as a formula, with a worked example using the seed data.

## States
- Empty state
- Loading state
- Error state
- Permission-denied state

## Out of scope (for this release)
Things visible in the mockup that are NOT built yet, and which release picks them up.

## Acceptance tests
Checklist written as "Given / When / Then". Each line becomes an automated test.

- [ ] Given …, when …, then …

## Open questions
Anything Blake must decide before this is built.
