---
change_id: testing-supply-engine-unit-coverage
title: Unit coverage for the supply engine and its display-path arithmetic
status: implemented
created: 2026-09-14
updated: 2026-09-15
archived_at: null
---

## Notes

Rollout Phase 1 of `context/foundation/test-plan.md`: "Supply-engine unit coverage".

**Risks covered:**

- **#1** — the supply engine computes a wrong supply-end date, and the wrong result renders identically to a correct one.
- **#2** — exact-decimal arithmetic recomputed with raw floats on the display path shows the user a plausible-but-wrong number.

**Test types planned:** unit.

**Risk response intent (from test-plan.md §2 Risk Response Guidance):**

- **Risk #1** — prove the engine produces the exact documented date, reason, and projected quantity across the worked examples and edge cases (single/multiple refills, dosage change between events, expiry cap, breakpoint past the cap, exhaustion-then-refill, zero-dose segments). Challenge "the date looks plausible" as not the same claim as "the date is right" — the oracle must come from independently hand-worked arithmetic, never from reading the function's own current output. Avoid the oracle problem.
- **Risk #2** — prove a rendered discrepancy or quantity notice matches the exact-decimal value, not the raw-float value, across integer, fractional, and precision-clamped cases. Challenge the assumption that a correct database row implies a correct display; they are two independent computations. Avoid testing only the write path and assuming the display path inherits its correctness.

**Prior specification worth reading before planning** — four earlier slices deferred their suites and each left a written spec. `supply-status-dashboard/follow-ups/supply-engine-tests.md` is the closest to this phase's scope (it names the six worked examples, the two assertions most likely to be silently "corrected", and the display-path defect found by hand on 2026-09-10). `mid-supply-dosage-change/follow-ups/deferred-tests.md` adds the shapes S-05 made reachable. Those queues say to write one suite, not several.
