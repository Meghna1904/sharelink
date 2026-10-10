# ShareLink

A private space for two people to collect and share links together.

## Design decisions

**Visual identity.** A restrained warm-neutral palette — parchment surface, deep charcoal ink, single terracotta accent — with Fraunces (an expressive optical-size serif) for wordmarks and headings, and Inter for body and UI. No gradients, no heavy card borders. Depth comes from subtle rule lines and spacing, not shadows.

**Organizing idea: editorial day feed.** Saved links appear as a chronological list grouped under italic day labels ("Today", "Yesterday", or a weekday date). Items sit on fine horizontal rules — like a shared bulletin board or read-later journal — not a grid of rounded cards. The most recent finds are always at the top.

**Partner attribution.** Each partner is assigned one of four muted dot colors (sage, rose, slate, ochre) based on the order their name first appears. A small filled circle precedes every entry with a tooltip naming the saver. Clean, not cluttered.

**Every state is designed.**
- *Login* — centered, wordmark-led, warm copy, inline field hints.
- *Loading* — spinner in the status bar below the composer, not a full page block.
- *Title fetching* — "Fetching page title…" shown while the server scrapes, so paste-and-tap flows feel responsive.
- *Empty* — an editorial glyph (✦) with warm, human copy.
- *Error* — inline below the relevant field, with a ⚠ prefix, never a modal.
- *Edit* — composer expands inline, URL field pre-filled, "Discard edits" cancel.
- *Delete confirmation* — native `<dialog>` (keyboard-accessible, backdrop-dismissible), not a `confirm()`.

**Mobile-first.** The composer is a single-line paste field by default that expands on focus. The save button sits flush right to be reachable with one thumb. Touch targets are 44–54 px. The feed fills the viewport width up to 680 px.

**Accessibility.** Semantic HTML: `<header>`, `<section>`, `<article>`, `<ol>`, `<dialog>`. All inputs are labelled. `aria-live="assertive"` on error regions. `aria-live="polite"` on the feed. Visible focus rings (2.5 px outline offset) on every interactive element. Sufficient contrast in both light and dark (auto-detected via `prefers-color-scheme`).

**Motion.** New items fade up 8 px on entry. The composer extras slide down on focus. All animation is under 220 ms and is disabled when `prefers-reduced-motion: reduce` is set.

---

## Stack

- **Backend** — Node.js 24, `node:http`, `@neondatabase/serverless` (Postgres)
- **Frontend** — Vanilla HTML, CSS, ES modules — no framework, no bundler
- **Fonts** — Fraunces + Inter via Google Fonts

## Run locally

```bash
DATABASE_URL=postgres://... npm start
```

Open [http://localhost:3000](http://localhost:3000).

For production, set a secret to hash shared codes:

```bash
CODE_HASH_SECRET=replace-with-a-long-random-secret DATABASE_URL=postgres://... npm start
```

## How a shared space is created

There is no admin setup. The first time two people enter the same code, a space is created automatically.

1. Alice enters `Alice` and code `morning-coffee`.
2. Ben enters `Ben` and the same code `morning-coffee`.
3. Both land in the same shared link list.

The code is stored server-side as an HMAC-SHA256 hash — never in plain text.

## Tests

```bash
npm test
```
