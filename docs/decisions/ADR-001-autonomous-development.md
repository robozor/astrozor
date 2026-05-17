# ADR-001 — Autonomous development model and decision authority

**Status:** accepted
**Date:** 2026-05-17

## Context

Astrozor is developed by a single autonomous developer (Claude Code agent) under supervision of a human maintainer (robozor). The maintainer cannot review every line of code in real time. Some operating rules are needed to make the work safe, traceable, and resilient to interruptions.

## Decision

1. **Constraint: Docker-only.** No installation on the host machine. All builds, tests, and runtime happen in Docker containers (`docker compose -p astrozor`). Allowed host tools: `git`, `gh`, `docker`, the shells already present.
2. **Tracking files:**
   - `PROGRESS.md` — current state, updated after each meaningful change.
   - `BLOCKERS.md` — items waiting on the human maintainer; single source of truth.
   - `CHANGELOG.md` — released versions and what changed.
   - `docs/decisions/ADR-*.md` — non-trivial decisions made autonomously.
3. **Decision authority:**
   - **Small (autonomous):** library version pinning, file structure choices, error message wording, test coverage choices, internal API shapes. Documented in commit messages and (if non-obvious) in ADRs.
   - **Medium (autonomous + ADR):** swapping a sub-library that doesn't change architecture, simplifying a feature within the concept, adjusting acceptance criteria to make a Krok feasible.
   - **Large (pause and ask):** changing stack, breaking change to public API/spec, anything outside the application concept, anything irreversible (e.g. force-push to main, delete production data).
4. **Simplify rule.** When a problem becomes complex enough to risk progress, simplify or scope down (move advanced behavior to a later Krok). Document the simplification in `BLOCKERS.md` if it requires later resolution, or in an ADR otherwise.
5. **Test data.** If real test data is not provided in `seed-data/`, generate synthetic data (faker-like) that is plausible for the domain. Mark generated data clearly.
6. **Stop conditions:**
   - End of Krok with passing acceptance — continue to next Krok.
   - Hard blocker (cannot proceed without human) — record in `BLOCKERS.md`, work around if possible, otherwise pause and notify.
   - Failing tests after best effort — pause, document state, notify.

## Consequences

- The maintainer can `git pull && cat PROGRESS.md BLOCKERS.md` at any time to know the state.
- The audit trail (commits + ADRs + changelog) is human-readable in the GitHub UI.
- Small inconsistencies in style are acceptable; correctness and progress trump uniformity.
- This ADR can be superseded if the model proves wrong in practice.
