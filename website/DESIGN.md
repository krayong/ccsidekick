---
name: ccsidekick site
version: alpha
description: Design tokens for the ccsidekick landing page. The CSS :root is generated from this file into website/tokens.css by `bun run site:tokens`; do not hand-edit tokens.css. Colors/type/spacing reproduce the shipped values exactly; only the radius scale is newly unified.
colors:
    bg: "#0b0e14"
    bg2: "#070a0f"
    term-bg: "#0d1117"
    surface: "#131923"
    surface2: "#171e29"
    line: "#222a37"
    line2: "#2f3a4a"
    text: "#eaf0f7"
    muted: "#93a1b3"
    faint: "#7d899b"
    blue: "#5fafff"
    green: "#64d760"
    amber: "#ffd687"
    coral: "#ff8c87"
    grad: "linear-gradient(90deg, #5fafff, #64d760, #ffd687, #ff8c87)"
typography:
    mono: "ui-monospace, 'SF Mono', 'SFMono-Regular', Menlo, Consolas, 'DejaVu Sans Mono', monospace"
rounded:
    xs: "4px"
    sm: "8px"
    md: "10px"
    lg: "14px"
    pill: "999px"
    full: "50%"
spacing:
    nav-h: "60px"
    maxw: "1120px"
---

# Overview

The landing page speaks the product's own language: a dark terminal surface, monospace type, and the
signal triad (nominal green, caution amber, critical coral) that the status line itself uses. This file is
the machine-readable source of truth for the page's tokens. The generator emits them to `website/tokens.css`
as a `:root` block that `index.html` consumes; a drift check keeps the two in sync.

## Colors

Surfaces step from `bg` (page) through `surface`/`surface2` (cards, panels) with `line`/`line2` borders.
Text runs `text` (primary), `muted` (secondary), `faint` (tertiary, tuned to `#7d899b` so small text clears
the WCAG AA 4.5:1 floor on the page background). The signal roles are `green` (nominal), `amber` (caution),
`coral` (critical), with `blue` as the accent. `grad` is the four-stop brand gradient, reserved for the
wordmark and a small number of display accents. Every value here is the shipped value; none changed.

## Typography

One family: `mono`, the OS monospace stack. Hierarchy comes from size, weight, and tracking rather than a
second face, which keeps the page honest to a terminal tool. Sizes live in `index.html` (clamp-based) and are
unchanged.

## Layout

`maxw` (1120px) caps the content column; `nav-h` (60px) is the sticky nav height. Spacing elsewhere is the
page's existing scale, unchanged.

## Elevation & Depth

Depth is carried by the surface step (`bg` to `surface`/`surface2`) plus `line` borders and a small set of
accent-tinted glows defined in `index.html`. No new elevation was introduced.

## Shapes

The radius scale is the one thing this pass unifies. Six tokens, applied by element role so nested corners
stay consistent (an outer card is never more square than the control inside it):

- `xs` (4px): hairline marks, the focus ring, scrollbar thumbs.
- `sm` (8px): buttons, inputs, small controls, badges, pills that are not fully round.
- `md` (10px): mid containers (tab bars, summaries, character tiles, search fields, the reel video).
- `lg` (14px): cards and the configurator panel (`.window`, `.pk`, `.wcard`, `.tcard`, `.cfg-panel`). The
  card grids previously mixed 11px and 12px; they now all read `lg`, which is the only visible change here.
- `pill` (999px): fully rounded pills and toggles.
- `full` (50%): circles (dots, swatches, the toggle knob).

## Components

- **card** (`.pk`, `.wcard`, `.tcard`): `surface` background, `line` border, `rounded.lg`.
- **panel** (`.cfg-panel`): `surface` background, `line` border, `rounded.lg`.
- **button** (`.cfg-tab`, `.cfg-char`, `.subtab`): `rounded.sm`; interactive targets meet a 44px touch floor.
- **input** (`.cfg-search`, `.theme-search`): `rounded.sm`.
- **pill** (`.cfg-theme`, toggle track): `rounded.pill`.
- **badge** (`.pk .badge`): `rounded.sm`.

## Do's and Don'ts

- Do pull every radius from the `rounded` scale; do not introduce a one-off `border-radius` value.
- Do keep an outer container's radius greater than or equal to the controls nested inside it.
- Do reserve `grad` for the wordmark and at most one display accent; do not paint it over the signal colors,
  which carry meaning.
- Do use `faint` for small tertiary text, never a raw grey below the AA contrast floor.
- Do not hand-edit `website/tokens.css`; edit this file and run `bun run site:tokens`.
