# ADR-009 — `markdownz` for Zooniverse project descriptions

**Status:** accepted
**Date:** 2026-05-29

## Context

The citizen-science page (`CitizenSciencePage.tsx`) renders Zooniverse project descriptions fetched from the Panoptes API. Those descriptions are authored in **Zooniverse-flavoured Markdown** — CommonMark + GitHub-Flavored Markdown (tables, autolinks, task lists) plus two Zooniverse-specific extensions:

- `![alt](url =NNNx)` / `=NNNxMMM` — explicit image width (and optional height) in pixels.
- `+tab+URL` — link that opens in a new tab.

Until v1.2.9 we rendered the description as plaintext (`<p className="whitespace-pre-wrap">`). Tables, image sizing and the custom link syntax all leaked as raw markdown source — see the `Galaxy Zoo: Clump Scout II` page for the reported regression.

## Decision

Render Zooniverse descriptions with [`markdownz`](https://github.com/zooniverse/markdownz) — Zooniverse's own React markdown component (Apache 2.0, package name `markdownz` on npm). It already implements the two custom extensions identically to how they appear on `zooniverse.org`, so the on-Astrozor output matches the upstream project page line-for-line.

- Used only inside `CitizenSciencePage.tsx` for project `introduction` and `description`.
- Wrapped via `.docs-prose` styling for dark theme parity with articles.
- Ambient TypeScript declaration lives at `frontend/src/types/markdownz.d.ts` (the package ships only CJS + PropTypes).

## Consequences

- One new runtime dependency on the frontend bundle. Package size: ~137 KB unpacked, 15 transitive deps (`markdown-it` family + `isomorphic-dompurify` for sanitisation + `@twemoji/api`). Rendered HTML is DOMPurify-sanitised inside the package — no XSS surface added on our side.
- Visual output of Zooniverse descriptions on Astrozor is now intentionally tied to whatever Zooniverse's upstream renderer does. If they bump major versions with breaking changes we must follow.
- Other markdown surfaces (articles, docs, chat) keep their existing server-side `bleach` + custom Python pipeline — `markdownz` is **only** used for Zooniverse-sourced content.

## Alternatives considered

- **`react-markdown` + `remark-gfm` + custom `=NNNx` / `+tab+` plugins** — rejected. We would reimplement what Zooniverse already maintains and would have to track their extensions ourselves. More code, identical bundle footprint after deps.
- **Server-side Python rendering, mirror articles pipeline** — rejected. Adds a second markdown stack with Zooniverse-specific quirks to maintain in Python where there is no existing Zooniverse-compatible lib. Frontend rendering keeps the surface narrow.
- **Status quo (plaintext + `whitespace-pre-wrap`)** — rejected, that is the bug we are fixing.
