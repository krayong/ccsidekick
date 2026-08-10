# CLAUDE.md: landing site

The ccsidekick landing page: a single page deployed as a Cloudflare Worker at
`ccsidekick.krayong.com`. Everything in `website/` is served as-is; the build logic that produces
the generated files lives in `scripts/website/*.ts`.

**It is no longer assets-only.** `wrangler.jsonc` sets `main` to `scripts/website/worker.ts` and
`assets.run_worker_first` to `["/e"]`, so every path except `/e` keeps asset-first behaviour and
`/e` alone reaches the Worker. That Worker is an event sink: it accepts a `POST` of one name from a
closed allowlist and writes a single Workers Analytics Engine data point. Cloudflare Web Analytics
is pageviews only and does not support custom events, which is why it exists.

## The one rule: edit sources, not outputs

Most files here are **generated build artifacts** (gitignored) and are overwritten by `site:build`.
Editing them does nothing lasting. Edit the source, then rebuild.

| Generated (gitignored)                                                                      | Its source                                                                    |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `index.html`, `llms.txt`, `sitemap.xml`, `robots.txt`                                       | the matching `*.template.*` (resolved by `scripts/website/site-html.ts`)      |
| `tokens.css`                                                                                | `DESIGN.md` (via `scripts/website/site-tokens.ts`)                            |
| `data.js`                                                                                   | core character/theme/widget data (via `scripts/website/site-data.ts`)         |
| `render-web.js`                                                                             | `packages/core/src/web/**` (bundled by `scripts/website/build-render-web.ts`) |
| `characters.mp4`, `characters-poster.jpg`, `wordmark.svg`, `og.png`, `apple-touch-icon.png` | `assets/` (copied by `scripts/website/site-assets.ts`)                        |

**Committed sources** (safe to edit): `index.template.html`, `styles.css`, `DESIGN.md`, `_headers`,
`_redirects`, `favicon.svg`, the other `*.template.*`, and `vendor/` (GSAP + ScrollTrigger).

## Where to change what

- **Copy / prose / identity URLs** → `scripts/website/site-content.ts` (single source; the tagline,
  meta, FAQ, and all section text live here once, then flow into the template as `{{tokens}}`).
- **Design tokens** (colors, type, radii, spacing) → `DESIGN.md`, then `bun run site:tokens`. Never
  hand-edit `tokens.css`.
- **Markup + interactive JS** (the character wall, configurator, theme/widget browsers, request CTA,
  scroll reveals) → `index.template.html`. The page's client JS is inline in a `<script>` at the
  bottom; it reads the generated `data.js` (`window.__CCSK`).
- **Visual styling** → `styles.css` (hand-authored, monospace/terminal aesthetic, printWidth-tab
  Prettier like the rest of the repo).

## Templating

`*.template.*` files carry `{{token}}` placeholders resolved in a **single pass** by
`scripts/website/site-template.ts` against the context from `site-context.ts` (which spreads in
`site-content.ts` plus release-varying values: version, counts, base URL). Because it is
single-pass, content values must not themselves contain `{{tokens}}`; interpolate counts in
`site-content.ts`, not in the template.

## Build & preview

Run from the workspace root:

- `bun run site:build`: full rebuild (assets → tokens → data → html → render-web).
- `bun run site:serve`: build, then serve at `http://localhost:8129/`. The dev server honors
  `_redirects` so branded paths preview locally.

## Deploy & platform files

- Deployed by `.github/workflows/deploy.yml` on release tags via `wrangler deploy` (config:
  `wrangler.jsonc` at the repo root). No `*.workers.dev` URL; the custom domain is the only entry.
- `_headers` sets a **strict CSP**: `default-src 'self'`, `connect-src 'self'`,
  `form-action 'none'`, `object-src 'none'`. The only off-origin request is the Cloudflare Web
  Analytics beacon, allowed explicitly in `script-src`/`connect-src`; the `/e` event POST is
  same-origin and needs nothing. Anything new that would fetch, embed, or post off-origin needs a
  deliberate CSP change here first. Note `_headers` does not apply to responses the Worker itself
  generates, only to asset responses.
- `scripts/website/worker.ts` is the Worker entrypoint, covered by `scripts/website/worker.test.ts`.
  There is no preview URL and no staging origin (`workers_dev` and `preview_urls` are both false),
  so those tests are the only exercise it gets before production. `/e` is public and unauthenticated:
  its Origin check stops cross-site abuse and nothing else, so volume abuse is held off by a
  Cloudflare Rate Limiting rule configured in the dashboard, not in this repo.
- The deploy fingerprint in `deploy.yml` hashes `website/`, `wrangler.jsonc`, and
  `scripts/website/worker.ts` together. Adding a deployable file outside those paths means adding it
  there too, or a change to it will hit the cache and silently skip the deploy.
- `_redirects` holds branded redirects (matched before the SPA fallback). The "Request a character"
  CTA links to `/request-a-character`, which 302s to the Google Form, so the form URL lives in one
  place, not in site content.
- `not_found_handling: single-page-application` (in `wrangler.jsonc`) serves `index.html` at 200 for
  unknown paths.

## Notes

- The live demo renders real status lines **in-browser** by running the core render pipeline through
  `render-web.js` (Node-API shims under `packages/core/src/web/`); it is not shipped to npm.
- SEO/agent surfaces are single-sourced too: the FAQ feeds both the visible `<details>` and the
  JSON-LD, and `llms.txt` / `sitemap.xml` / `robots.txt` are templated. Keep them in sync via the
  template sources, not the outputs.
