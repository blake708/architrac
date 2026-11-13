# ArchiTrac Design System

The look is drawn from architectural drawing sets: greyscale, crisp 1px lines, square corners, uppercase labels, monospaced numbers. Color is used only to carry meaning (status, warnings, add-ons). Tokens are in `src/styles/tokens.css`; see them in use in the rendered mockup (link in README.md).

## Foundations

| Token group | Rule |
|---|---|
| Fonts | **Barlow** (400/500/600/700) for UI text; **IBM Plex Mono** (400/500/600) for numbers, dates, IDs, meta lines. Load both with `next/font/google`. |
| Base size | 14px body; 13px in dense tables; 11–12px for captions and table headers. |
| Case | H1, H2, table headers and captions are uppercase with 0.08em letter-spacing (via CSS, not typed). |
| Radius | 2px everywhere. Circles only for avatars and dots. |
| Borders | 1px `line` (#DCDCDC) for cards/tables; `line-input` (#D4D4D4) for controls. |
| Shadows | None. Separation comes from borders and background steps (canvas → surface). |
| Page | Canvas #F2F2F2; white cards; 32px side padding (16px under 640px wide). |

## Color meaning

| Color | Means | Examples |
|---|---|---|
| Ink #141414 | Primary action, active nav | Primary button, selected rail item, top header |
| Blue #2F5BAA | Information, current | Current phase, links inside data, "In progress" badge |
| Green #1D6234 | Good / done | Paid, approved, under budget |
| Orange #C2410C | Needs attention | Approaching budget (≥ 90%), timesheet due, NTE cap near |
| Red #B42318 | Problem | Overdue invoice, over budget, validation error |
| Purple #5B2E9E | Add-on / tentative | Module badges in the rail, tentative pipeline work |

Badges use the tint as background and the strong color as text (e.g. green-tint + green). Never rely on color alone: badges always have a text label.

## Components (build these first, in `src/components/ui/`)

| Component | Spec |
|---|---|
| **Button** | Height 38px, padding 0 14px, 2px radius, weight 500. Variants: `primary` (ink bg, white text), `secondary` (white bg, line-input border), `ghost` (transparent), `danger` (red text/border). Optional leading 15px icon. |
| **Input / Select / Textarea** | Height 38px, white, 1px line-input border, 2px radius, 0 10px padding; focus ring 2px blue. Label above in 12px muted uppercase caption. Error text 12px red below. |
| **Table** | Header row surface-2, 11px uppercase muted, a 1px `line` above and below (set globally in `tokens.css`; small tables nested inside a row stay plain; a table at the very top of a card adds `table-flush-top` so the card border is the line above); body 13px; numeric columns right-aligned in mono; row divider line-soft; hover row surface-2. |
| **Card** | White, 1px line border, 2px radius, 20px padding; header with uppercase title and optional actions on the right. |
| **KPI tile** | Card with caption label, 26px Barlow value (tabular figures, as in the mockup), optional delta/status line. |
| **Header KPIs** | On list pages (Projects, Time, Contacts, Team) the summary tiles sit inside the white page-header band, under a `line-soft` rule, with the tab bar below them: `<HeaderKpis>` + `<KpiTile variant="header">` as `PageHeader` children. Flat tiles, 20/22px vertical padding, page-x side padding, `line-soft` dividers. |
| **Filter buttons** | Grouped in a `track` (#E3E3E3) tray with 3px padding: 30px tall, 12px uppercase (0.06em); the chosen one white with a small shadow, others ink-3. `segmentGroupClasses` / `segmentClasses()` in `src/components/ui/segmented.ts`. |
| **Aging bar** | Receivables aging (Invoices page): a 28px bar of five segments sized by amount, then a key of five (swatch, uppercase label, amount, count). One orange ramp from tokens `age-current` (#D6E0F2), `age-30`, `age-60`, `age-90`, `age-90-plus` (#7A2A08). Picking a segment or key item filters the list; the others dim. `src/components/invoices/aging-bar.tsx`. |
| **Tabs** (menu bar) | Underline style, as in the mockup: 12.5px uppercase (0.07em), 50px tall, 12px side padding, 6px apart; current tab bold ink with a 3px rule under it, others ink-3. Counts in mono 11px muted. Use `tabClasses()` from `src/components/ui/tab-styles.ts` (or `Tabs` from `ui/tabs.tsx`). Tab bars always sit at the bottom of the white header band, under a `line-soft` rule (`headerTabBarClasses`); on a project page the phase stepper sits above them. |
| **Badge** | 11px uppercase, 2px radius, 2px 6px padding, tint background + strong text. |
| **Progress bar** | 10px high, line-soft track, blue fill. At ≥ 90% the percent text turns orange (fill stays blue). Over 100% the bar is rescaled to the amount used: blue up to the budget, then a red hatched segment for the overrun, and red percent text. Used for hours vs budget. |
| **Avatar** | Circle, initials 11px weight 600, ink-2 background, white text. |
| **Dialog / Drawer** | Radix Dialog; white, 2px radius, header with uppercase title, footer right-aligned actions. |
| **Empty state** | Centered in card: 1-line title, 1-line help text, one primary action. |

## App shell

- **Menu rail** (left): 216px expanded / 64px collapsed; black background (`--color-rail`). Rows: 20px icon + label to the right. Active row = `#2A2A2A` background, white text, 2px white bar on the left. Group label "MODULES" (10.5px caption) above add-on modules. Modules that are off are hidden from project managers and staff; owners and admins see them dimmed with an "ADD" badge. Collapse toggle at bottom; state remembered per browser (cookie). Full detail: `specs/release-0/app-shell.md`.
- **Top header**: ink background, 10px 32px padding; firm switcher button (initial square + firm name + chevron), page title (uppercase), then right side: search (chrome-2 field), notifications (orange dot), settings gear, avatar.
- **Page header**: white band under the top header, 32px padding; mono meta line (12px, e.g. date · counts), H1 30px weight 500, actions on the right.

## Formatting

| Value | Format | Example |
|---|---|---|
| Money | `$` + thousands separators; cents only when not whole; negative as `−$` (true minus sign) | $186,000 · $11,494.80 · −$12,318 |
| Hours | Up to 2 decimals, trailing zeros dropped (quarter hours); mono | 37.5 · 40 · 7.25 |
| Percent | Whole number + % | 82% |
| Dates | `MMM D, YYYY` in tables; meta lines uppercase `SUNDAY, OCTOBER 18, 2026` | Oct 18, 2026 |
| Invoice no. | prefix + number | 2026-121 |

All formatting goes through `src/lib/format.ts`.

## Accessibility

WCAG 2.1 AA: text contrast ≥ 4.5:1 (all token pairs above pass on white/canvas), visible focus ring, every icon-only button has `aria-label`, tables use real `<table>` markup, dialogs trap focus (Radix does this).
