# ADR-002 — Tier 0 publishing (no server-side user code execution)

**Status:** accepted
**Date:** 2026-05-17 (decided 2026-05-17 in the requirements Q&A)

## Context

Astrozor must support publication of articles in Quarto, R Markdown, Jupyter, and Markdown. Originally a server-side rendering pipeline with a sandboxed worker was considered (gVisor / Firecracker / hardened Docker). The threat model of executing arbitrary user code on a shared multi-tenant host is non-trivial — kernel CVEs, sandbox escape vectors, resource exhaustion.

## Decision

**Astrozor never executes user code on the server.** All rendering (Quarto, R Markdown, Jupyter notebooks with Python/R/Julia code, etc.) happens **locally on the contributor's machine**. Astrozor accepts only **pre-rendered output** (HTML + assets) via a publishing API.

Five publishing channels are supported:
1. Web UI drag-and-drop upload.
2. CLI `astrozor` (Python, pip-installable).
3. Quarto custom publishing provider (`quarto publish astrozor`).
4. VS Code extension.
5. R package + RStudio addin.

All five speak the same REST publishing API with shared `manifest.json` schema.

## Consequences

- **Security:** server-side attack surface for code execution is zero. Standard HTML sanitization (`bleach`) + strict CSP (`script-src 'none'`) defend against malicious uploads.
- **Cost:** no sandbox infrastructure (`worker-render` container, gVisor runtime, per-engine images).
- **Trade-off:** contributors must have a local Python/R/Julia + Quarto stack. We do not lower the barrier for non-technical users via a hosted notebook. Acceptable for the audience (active astronomers, citizen scientists with existing setups).
- **Out of scope going forward:** any feature that implies running user code server-side. If demand grows for a hosted notebook (Tier 3 — JupyterHub-like workspaces), it will be a separate project with its own audit.

## Related

- `requirements/specification.md` §6.9 (Publishing pipeline)
- `requirements/decisions-qa.md` Q1 (sandbox technology) — resolved as N/A by this ADR.
