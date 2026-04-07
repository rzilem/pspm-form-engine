# PSPM DESIGN.md

Canonical design system for all PS Property Management web applications.
Drop this file into the root of any PSPM repo. AI agents should read it before generating or modifying UI.

**Applies to:** unified-command-center, pspm-onboarding-portal, hoa-crm, pspm-form-engine, harmony-web-dev, board-onboarding, bid-request-system, and all future PSPM web apps.

---

## 1. Visual Theme & Atmosphere

Professional, trustworthy, calm. PSPM manages HOAs — users are property managers, board members, and homeowners dealing with money, rules, and community matters. The interface should feel like **a well-organized office binder**, not a consumer app.

- **Voice:** competent, quiet, exact
- **Feel:** Notion / Linear / Stripe Dashboard — dense but legible, structured, no flourish
- **Avoid:** gradients-as-decoration, neon glows, dark neon "trading app" vibes, purple/cyan gaming palettes, animated hero sections, glassmorphism on data surfaces
- **Density:** medium-high. Managers look at 100+ rows at a time. Don't waste space on mood.

---

## 2. Color Palette

### Brand (locked — never substitute)

| Token | Hex | Usage |
|---|---|---|
| `pspmBlue` | `#3A4DA8` | Primary. Buttons, links, active nav, key KPIs. From psprop.net header. |
| `pspmNavy` | `#1B4F72` | Secondary. Headers, secondary buttons, chart accents. |
| `pspmBrandGreen` | `#4CB648` | Success, positive deltas, "paid/current" states, completion. |

### Forbidden

- **`pspmCyan` / any cyan / teal / turquoise** — NEVER. This is the single strictest rule. Every past regression has involved a tool defaulting to cyan. If a generator outputs `#06b6d4`, `#22d3ee`, `cyan-500`, or similar — remap to `pspmBlue`.
- **Pure navy** (`#001F3F`, `navy-900`, etc.) — use `#3A4DA8` (psprop.net blue) instead. Navy reads as generic corporate.
- **Dark hero gradients** (`from-slate-900 to-blue-900`) on dashboards. Looked "premium" once, read as Robinhood-clone every time since.

### Semantic

| Role | Color | Notes |
|---|---|---|
| Success | `#4CB648` (pspmBrandGreen) | Use sparingly — only confirmed positive state |
| Warning | `#F59E0B` (amber-500) | Aging, nearing deadline, needs attention |
| Danger | `#DC2626` (red-600) | Overdue, critical, destructive actions |
| Info | `#3A4DA8` (pspmBlue) | Neutral informational — same as primary |
| Muted | `#6B7280` (gray-500) | Secondary text, disabled, metadata |

### Neutrals

Use Tailwind `slate` or `gray` scale. Backgrounds:
- Page: `#F8FAFC` (slate-50) or `#FFFFFF`
- Card: `#FFFFFF`
- Border: `#E5E7EB` (gray-200)
- Text primary: `#0F172A` (slate-900)
- Text secondary: `#475569` (slate-600)

---

## 3. Typography

### Font

- **Primary:** Inter (all weights 400/500/600/700). Load via `next/font/google` or self-host. Do NOT use system fonts as fallback for production UI.
- **Cursive (signatures only):** Caveat. Never use for body, headings, or decoration.
- **Monospace (code/data only):** `ui-monospace`, `SF Mono`, `Menlo`.

### Scale

| Role | Size | Weight | Line height |
|---|---|---|---|
| Page title (`h1`) | 24px / 1.5rem | 600 | 1.3 |
| Section title (`h2`) | 18px / 1.125rem | 600 | 1.4 |
| Card title (`h3`) | 16px / 1rem | 600 | 1.4 |
| Body | 14px / 0.875rem | 400 | 1.5 |
| Secondary / metadata | 12px / 0.75rem | 400 | 1.4 |
| Form input | **16px minimum** | 400 | 1.5 (iOS zoom-prevention) |

### Rules

- Never use `text-xs` (`10px`) for anything a user needs to read. Reserve for badges and tag overflow.
- No `!important` font sizes. No px fonts in CSS when Tailwind utilities exist.
- Headings: 600 weight. Body emphasis: 500. Bold (700) only for KPI numbers.
- Title case on buttons and nav, sentence case on body copy and form labels.

---

## 4. Component Styling

### Buttons

- Primary: `bg-[#3A4DA8] text-white hover:bg-[#2F3F8C]`, radius `8px`, padding `10px 16px`, weight 500
- Secondary: `border border-gray-300 bg-white text-slate-900 hover:bg-gray-50`
- Destructive: `bg-red-600 text-white hover:bg-red-700`
- Disabled: `opacity-50 cursor-not-allowed` — do NOT gray out to invisibility
- Focus: `focus-visible:ring-2 focus-visible:ring-[#3A4DA8] focus-visible:ring-offset-2`

### Cards

- `bg-white border border-gray-200 rounded-xl p-6` (radius **12px**)
- Shadow: `shadow-sm` only. Never `shadow-2xl`. Never inner glows, never ring-colored glows.
- Card title row: `flex items-center justify-between mb-4`

### Inputs

- `h-10 px-3 rounded-lg border border-gray-300 bg-white text-[16px]` (radius **8px**)
- Focus: `focus:border-[#3A4DA8] focus:ring-1 focus:ring-[#3A4DA8]`
- Label: `text-sm font-medium text-slate-700 mb-1.5`
- Error state: `border-red-500 text-red-900`, helper text below in `text-sm text-red-600`
- Min height 40px on touch targets (44px for primary mobile actions)

### Tables

- Row height: `h-12` minimum, `h-14` for dense data
- Header: `bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500`
- Row border: `border-b border-gray-100`
- Hover: `hover:bg-gray-50`
- Sortable columns: chevron indicator, click target is full header cell
- Empty state: centered icon + text inside the table body, not a separate page

### Status pills (`StatusPill` primitive)

Use for workflow status, payment state, signing state. Color-coded by meaning, not aesthetics.

| State | Background | Text |
|---|---|---|
| Completed / Signed / Paid | `bg-emerald-50` | `text-emerald-700` |
| In Progress / Pending | `bg-blue-50` | `text-blue-700` |
| Waiting / Draft | `bg-gray-100` | `text-gray-700` |
| Overdue / Failed | `bg-red-50` | `text-red-700` |
| Warning / Aging | `bg-amber-50` | `text-amber-700` |

Pill shape: `rounded-full px-2.5 py-0.5 text-xs font-medium`.

### Modals / Sheets / Dialogs

- Use shadcn `Dialog` / `Sheet` primitives. Don't hand-roll overlays.
- Max width `600px` for forms, `900px` for detail views.
- Close button top-right, ESC + backdrop click both dismiss.
- Never trap focus across modals — one modal at a time.

---

## 5. Layout & Spacing

### Page shell (house style — enforce consistently)

```tsx
<div className="flex flex-col h-full">
  <Header title="..." />
  <div className="flex-1 overflow-y-auto p-6">
    <div className="space-y-6">
      {/* content */}
    </div>
  </div>
</div>
```

**Every dashboard page in UCC follows this pattern.** Server `page.tsx` owns the shell; dashboard component inside owns `space-y-6`. Do NOT let content go edge-to-edge without `p-6` wrapper.

### Spacing scale (Tailwind defaults)

Use `2 / 3 / 4 / 6 / 8` for gaps and padding. Avoid arbitrary values (`p-[13px]`). Maintain rhythm:
- Between sections: `space-y-6` (24px)
- Between card content blocks: `space-y-4` (16px)
- Between related items: `space-y-2` (8px)
- Card padding: `p-6` (24px), dense variants `p-4`
- Page padding: `p-6` desktop, `p-4` mobile

### Grid

- `gap-4` default, `gap-6` for cards with breathing room
- Dashboard KPI row: `grid-cols-1 md:grid-cols-2 lg:grid-cols-4`
- Content + sidebar: `grid-cols-1 lg:grid-cols-[1fr_320px]`

---

## 6. Depth & Elevation

Keep it **flat**. Elevation communicates state, not decoration.

| Level | Usage | Shadow |
|---|---|---|
| 0 | Page background, table rows | none |
| 1 | Cards, form sections | `shadow-sm` |
| 2 | Dropdowns, popovers | `shadow-md` |
| 3 | Modals, sheets | `shadow-xl` |

No neumorphism. No colored shadows. No glow. No `ring-4 ring-blue-500/50` for emphasis — use border color or background tint.

---

## 7. Do's and Don'ts

### Do

- Use `pspmBlue` (`#3A4DA8`) for every primary action and link
- Use Inter everywhere
- Match the page-shell pattern on every new dashboard route
- Check existing components in `src/components/ds/` before building new ones
- Use semantic status colors from the table above
- Test mobile (360px) and desktop (1440px) before shipping
- Run QA Pipeline Pass 3 visual check on any frontend diff
- Reserve Caveat font exclusively for signature capture

### Don't

- **NEVER use cyan / teal / `pspmCyan` / `cyan-*` / `#06b6d4`** — remap to `pspmBlue`
- Don't use dark gradient heroes on dashboards
- Don't use navy (`#001F3F`) — use psprop.net blue (`#3A4DA8`)
- Don't `console.log` in production code
- Don't hardcode URLs — use env vars
- Don't use `any` TypeScript types
- Don't build one-off components when a DS primitive exists
- Don't animate KPI cards (no RadialBar gauges, no spinning rings, no pulse glows)
- Don't use `text-xs` for body content
- Don't ship without running the QA pipeline
- Don't let content render edge-to-edge on pages — always `p-6` wrapper

---

## 8. Responsive Behavior

- **Breakpoints:** Tailwind defaults (`sm:640 md:768 lg:1024 xl:1280 2xl:1536`)
- **Mobile-first** for forms and public-facing pages (signing portal, form engine, bid portal)
- **Desktop-first** acceptable for staff dashboards (UCC, hoa-crm, harmony) — managers use desktop 95% of the time, but never ship a dashboard that crashes or overflows on mobile
- Tables on mobile: switch to stacked card layout below `md`, or enable horizontal scroll with sticky first column
- Touch targets ≥44px on all public surfaces
- Viewport meta tag always present; test with Chrome DevTools mobile emulation before push

---

## 9. Agent Prompt Guide

When generating or editing UI in a PSPM repo, AI agents should:

1. **Read this file first.** If it's not in the repo root, ask whether to copy it from `C:\Users\ricky\pspm-design.md`.
2. **Use brand tokens verbatim.** `#3A4DA8`, `#1B4F72`, `#4CB648`, Inter. No substitutions.
3. **Check `src/components/ds/`** (or equivalent) for existing primitives: `PSPMHeader`, `StatusPill`, `Card`, `InlineEditableText`, `TaskDetailPanel`, `FilterToolbar`, `SignaturePanel`, etc. Reuse before creating.
4. **Follow the page-shell pattern** (section 5) on every new dashboard route.
5. **Run the QA pipeline** (`node ~/bin/qa-agent/src/cli.js`) before pushing. Pass 3 will catch visual regressions automatically.
6. **Reject cyan at the first sight.** If any generator, theme, Stitch variant, or template includes cyan or teal, normalize to `pspmBlue` immediately. This is non-negotiable.
7. **When unsure, match the look of:** the UCC Conversations page, the onboarding portal `/projects/[id]` page, or the hoa-crm proposal viewer. These are the reference surfaces.
8. **Don't invent new colors.** If you need a new semantic, derive it from an existing brand color (e.g., `pspmBlue/10` for tints), don't introduce a new hex.
9. **Ask before adding a dependency.** shadcn + Tailwind + lucide-react + recharts are the standard stack. Don't bring in MUI, Chakra, or Material Symbols.
10. **Preserve accessibility.** WCAG AA contrast, keyboard nav, `aria-*` attributes, focus-visible rings. Pass 3 a11y checks must be green.

---

*Last updated: 2026-04-07 — initial canonical draft, synthesized from Wave B onboarding portal learnings, UCC house style, QA pipeline v4 rules, and accumulated feedback memories.*
