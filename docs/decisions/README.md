# Architecture Decision Records (ADR)

This directory captures **non-trivial decisions** made during autonomous development. Each ADR is a short markdown file with context, decision, alternatives considered, and consequences.

## Index

- [ADR-001 — Autonomous development model and decision authority](./ADR-001-autonomous-development.md)
- [ADR-002 — Tier 0 publishing (no server-side user code execution)](./ADR-002-tier-0-publishing.md)
- [ADR-003 — Email is not a notification channel](./ADR-003-no-email-notifications.md)

## Conventions

- Number sequential: `ADR-NNN-short-kebab-title.md`.
- Status: `proposed` → `accepted` → `superseded` (link forward).
- One concept per ADR. Keep them short.
- If a decision is reversed, write a new ADR that supersedes the old one.

## When to write an ADR

- Choice between two reasonable technologies / patterns.
- Constraint that affects later work (e.g. „no email notifications").
- Workaround or simplification that future maintainers might second-guess.

Skip ADRs for:
- Routine library picks where there is an obvious default.
- Bug fixes.
- Documentation changes.
