# Brand Refresh — Teal Palette + Collaborative-Agent Logo

**Date:** 2026-06-21
**Status:** Design (awaiting user approval)
**Topic:** Visual identity refresh for the Agent Task Market website

## Goal

Refresh the website's visual identity so it (a) signals the project's purpose —
*many AI agents collaborating to do tasks* — through the logo, and (b) aligns
the theme color with the look of [openclaw.ai](https://openclaw.ai): a bright
**teal** accent (`#00e5cc`) in place of the current generic blue (`#3b6cf6`).

This is a **website-only visual change**. The backend, MCP server, and the
in-app product UI in `backend/public/` are out of scope.

## Decisions (locked with user)

| Decision | Choice |
| --- | --- |
| Accent color | Teal, close to openclaw's `#00e5cc` |
| Dark mode | Keep Starlight default (follows system); only swap the accent — do **not** force dark |
| Logo concept | **Node network** — nodes joined by links into a constellation, a few nodes highlighted as the collaborating agents |
| Scope | Website only (`website/`) |

## Color System

Starlight themes off three accent CSS variables per mode (`--sl-color-accent-low`,
`--sl-color-accent`, `--sl-color-accent-high`). The accent is used for links,
active nav, focus rings, and button fills, so it must clear contrast in **both**
modes. Bright teal works as-is on a dark background but is too light for link
text on white, so light mode uses a darkened teal.

**Dark mode** (`:root`) — bright teal on dark, matches openclaw:
```css
--sl-color-accent-low: #053b35;   /* deep teal — subtle backgrounds */
--sl-color-accent: #00e5cc;       /* brand teal — links, buttons */
--sl-color-accent-high: #9ff5e9;  /* pale teal — hover/active text */
```

**Light mode** (`:root[data-theme='light']`) — darkened teal for contrast on white:
```css
--sl-color-accent-low: #b8f0e8;   /* pale teal tint — backgrounds */
--sl-color-accent: #0a8c7d;       /* darkened teal — readable link text (≥4.5:1 on white) */
--sl-color-accent-high: #06463f;  /* darkest teal — hover/active text */
```

The brand anchor color for logo/OG art is `#00e5cc` (teal). A near-black
`#050810` (openclaw's background) is used as the logo/OG backdrop.

**Contrast check (acceptance):** the light-mode accent `#0a8c7d` on white must
meet WCAG AA for body/link text (≥ 4.5:1). Verified during implementation; if it
falls short, darken toward `#08766a`.

## Logo — Node Network

A small graph: 5–6 circular nodes connected by thin links, forming a balanced
constellation. Two or three nodes are filled with the brand teal (the "active"
collaborating agents); the rest are outlined. Conveys *many agents linked,
working together*. Renders legibly at favicon size (just dots + lines, no text).

**Assets produced:**

1. `website/public/favicon.svg` — the node-network mark on a transparent or
   rounded-square teal-tinted background, legible at 32px. Replaces the current
   white-"A"-on-blue square.
2. `website/public/og-image.svg` + `og-image.png` (1200×630) — dark `#050810`
   backdrop, the node-network mark in teal, the title "Agent Task Market", and
   the positioning line "Verifiable agent work over MCP." Replaces the current
   blue OG card.

The mark is hand-authored SVG (circles + lines), so it scales cleanly and needs
no raster source. The PNG OG image is rendered from the SVG via `sharp` (already
a dependency), as done previously.

## Files Touched

| File | Change |
| --- | --- |
| `website/src/styles/custom.css` | Replace the six blue accent values with the teal values above |
| `website/public/favicon.svg` | Replace "A" mark with the node-network mark |
| `website/public/og-image.svg` | Rebuild with teal mark on `#050810`, new tagline |
| `website/public/og-image.png` | Re-render from the new SVG via sharp |

`astro.config.mjs` already references `favicon: '/favicon.svg'` and the
`og-image.png` URL, so no config change is required — the asset files are
swapped in place.

## Out of Scope (YAGNI)

- Forcing dark mode as default (explicitly declined — keep system-following).
- Renaming the project or changing the wordmark text.
- Restyling the in-app `backend/public/` UI (different surface; can follow later).
- Custom fonts beyond the existing Inter.
- Animated/interactive logo (static SVG only).

## Testing / Acceptance

1. `npm run build` in `website/` passes clean (zero errors, zero broken links).
2. Built `dist/` contains the new `favicon.svg`, `og-image.svg`, `og-image.png`.
3. Light-mode accent `#0a8c7d` meets WCAG AA (≥ 4.5:1) on white; if not, darken.
4. Visual smoke via `npm run preview`: teal links/buttons in both light and dark
   mode; favicon shows the node mark; no leftover blue `#3b6cf6` in `custom.css`.
5. Grep: zero occurrences of `#3b6cf6` / `#244fe0` in `website/src` after the swap.

## Success Criteria

- The site reads as teal-accented (openclaw-adjacent), in both light and dark mode.
- The favicon and OG image show the node-network "collaborating agents" mark, not the old "A".
- Build is green and SEO assets (favicon, OG, sitemap) remain intact.
