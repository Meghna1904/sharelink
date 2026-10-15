# ShareLink

A private space for two people to collect and share links together.

---

## Design

### Visual Identity

A restrained, distinctive system built on three decisions:

1. **Palette** — Warm parchment surface (`hsl(36 14% 97%)`), deep charcoal ink, and a single terracotta accent (`hsl(17 55% 49%)`). Dark mode inverts to a warm charcoal ground with the same accent brightened for contrast. No stock gradients, no generic blues.

2. **Type pairing** — [Fraunces](https://fonts.google.com/specimen/Fraunces) (a wonky, optical-size serif) at light-300 or italic for the wordmark, day labels, and headings. [Inter](https://fonts.google.com/specimen/Inter) for all body and UI copy. The pairing creates clear hierarchy without relying on size alone — the display face has personality, the body face is invisible.

3. **Depth without borders** — No bordered cards, no rounded-card-on-grey. Entries sit on fine 1 px rule lines against the parchment surface. The sticky header uses a frosted-glass `backdrop-filter` at low opacity. Elevation comes from space and rule lines, not `box-shadow` everywhere.

### Organizing Idea: Quiet Editorial Feed

Saved links appear as a **chronological list grouped by day**, like a shared reading journal or a pair's bulletin board. Day labels are italic Fraunces, faint and graceful. A small terracotta dot marks today's group. Items sit on ruled lines — not in a grid, not in cards — so the content breathes.

The most recent finds always appear first. Long lists scroll naturally with comfortable thumb access.

### Partner Attribution

Each partner is assigned one of four muted tints — **sage · rose · slate · ochre** — the first time their name appears. This assignment is stable within a session.

Attribution is shown as a **monogram initial badge** (e.g. "A" for Alice) in that partner's tint, sitting in the attribution column to the left of each entry. On hover, the badge lifts slightly. A tooltip exposes the full name for clarity. Two partners sharing a list is immediately legible at a glance.

### Every State is Designed

| State | Treatment |
|---|---|
| **Login** | Centered, wordmark-led. Warm copy. Inline field hint explains the shared code. No separate "sign up" — the space is created automatically on first use. |
| **Loading** | Skeleton shimmer (3–4 placeholder items with animated gradient) replaces the feed on initial load. A small status bar below the composer shows "Fetching page title…" during URL scraping. |
| **Empty** | An italic Fraunces heading *"Nothing here yet"* beneath a gently pulsing ✦ glyph. Human, warm copy. Not a clinical icon-and-label pair. |
| **Add link** | The composer is a single URL field by default — paste-and-tap. On focus it expands (slides down) to reveal optional title and note fields. |
| **Title fetching** | "Fetching page title…" with a spinner appears in the status bar while the server scrapes the URL, so the action doesn't feel stalled. |
| **Edit** | Composer expands inline with the existing values. Button label changes to "Save changes". A "Discard edits" link appears. Page scrolls to composer. |
| **Delete confirm** | Native `<dialog>` with a backdrop blur. Warm copy: "Keep it" vs "Delete". Keyboard-accessible, focus-trapped automatically by the browser. Never `window.confirm()`. |
| **Error** | Inline below the relevant field, prefixed with ⚠. Never a modal alert. Field gets `aria-invalid` and an accent red ring. |
| **Session expired** | Detected on restore; silently returns user to login with a gentle explanation message. |

### Motion

- New list items **fade up 10 px** on entry, staggered 40 ms per item (max 280 ms total delay).
- Composer extras **slide down 6 px** when expanded.
- Control buttons (edit/delete) fade in at 0 → 1 opacity on row hover; always visible on touch devices.
- Deleted items fade out left before the list reloads.
- All animation respects `prefers-reduced-motion: reduce` — durations collapse to 0.01 ms.

### Mobile-First

- Single-field composer by default; expands on focus. Save button sits at the right thumb's reach.
- Touch targets: 44–54 px minimum height on all interactive elements.
- Control buttons always visible on `hover: none` devices.
- Feed column max-width 660 px, full-bleed on phones.
- Content-area padding collapses on narrow phones.

### Accessibility

- Semantic HTML: `<header>`, `<main>`, `<section>`, `<ol>`, `<li>`, `<dialog>`, `<time>`.
- All inputs have associated `<label>` elements. `aria-required`, `aria-invalid`, `aria-describedby` set programmatically.
- `aria-live="assertive"` on error regions; `aria-live="polite"` on the status bar.
- Visible focus rings: `2.5 px solid accent, offset 3 px` on every focusable element.
- Light and dark appearances both meet WCAG AA contrast for text.
- Delete dialog is focus-trapped by the native `<dialog>` element; backdrop click or Escape dismisses.
- Skeleton feed is `aria-hidden="true"` so screen readers skip it.

---

## Stack

| Layer | Technology |
|---|---|
| Backend | Node.js ≥ 22, `node:http`, no framework |
| Database | [Neon](https://neon.tech) Lakebase Postgres via `@neondatabase/serverless` |
| Auth model | Shared HMAC-SHA256 code hash — never stored in plain text |
| Frontend | Vanilla HTML + CSS + ES modules — no framework, no bundler |
| Fonts | Fraunces + Inter via Google Fonts |
| Deploy | Vercel (serverless) or any Node.js host |

## Run locally

```bash
npm install
npm run build           # compile TypeScript → dist/
DATABASE_URL=postgres://... npm start
```

Open [http://localhost:3000](http://localhost:3000).

For production, set a strong secret to hash shared codes:

```bash
CODE_HASH_SECRET=replace-with-a-long-random-secret \
DATABASE_URL=postgres://... \
npm start
```

## How a shared space is created

There is no admin setup. The first time someone enters a code, the space is created automatically.

1. Alice opens the app, enters `Alice` and code `morning-coffee` → space created.
2. Ben enters `Ben` and the same code `morning-coffee` → lands in Alice's space.
3. Both see each other's saved links in real time (on next load).

The code is stored server-side as an **HMAC-SHA256 hash** — never in plain text. Changing `CODE_HASH_SECRET` will invalidate all existing spaces.

## Tests

```bash
npm test
```

Tests cover the API routes: session creation, link CRUD, authorization (only the saver can edit/delete their link), and 404/405 handling.
