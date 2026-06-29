---
project: MedCalc
context_type: greenfield
updated: 2026-06-04
product_type: web-app
target_scale:
  users: medium
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  frs_drafted: 11
  quality_check_status: accepted
---

## Vision & Problem Statement

**Core pain:** An individual managing their own chronic medications cannot easily answer the question "do I need prescriptions renewed at my next doctor visit?" The calculation requires juggling medication quantities, expiry dates, current dosage, possible dosage changes, and the date of the next appointment. This is both a calculation burden (the math is non-trivial, especially when dosages change mid-supply) and a memory/reminder gap (no tool proactively surfaces when supply will run short).

**Primary persona:** An individual managing their own chronic medications long-term — the app replaces the fragile mental model they currently keep in their head.

**Trigger moment:** Before or during a doctor's appointment — needing to answer quickly which prescriptions to renew and in what quantity.

**Cost today:** Manual arithmetic across multiple medications, units, expiry dates, dosage schedules, and visit timing — error-prone and time-consuming.

## User & Persona

**Primary user:** An individual adult managing a stable or semi-stable set of chronic medications (e.g. blood pressure, thyroid, diabetes, psychiatric medications). May occasionally add temporary medications. Visits a doctor on a regular schedule (monthly, quarterly).

**Key behaviors:**
- Adds new medications when prescribed, updates quantities after filling a prescription
- Changes dosages when the doctor adjusts them
- Wants to know — at any moment — whether current supply outlasts the next scheduled visit
- Wants a heads-up before they run out or before a medication expires

**Open question (competitive landscape):** Whether equivalent apps already exist and why this one is being built — not yet diagnosed. Surfaced for /10x-prd's Open Questions.

## Access Control

**Auth mechanism:** Email + password login. Each user registers and authenticates with credentials; data is stored server-side tied to their account, accessible from any device via browser.

**Role model:** Flat — every registered account is a regular user. No admin roles, no caregiver/patient distinction in MVP.

**Scope note:** Additional accounts (e.g. managing medications for children or other family members) are explicitly out of scope for MVP (see Non-Goals).

## Success Criteria

### Primary
User adds one or more medications (name, quantity on hand, expiry date, current daily dosage) and at least one upcoming doctor visit date. The app calculates and displays — for each medication — the date until which the current supply lasts, and tells the user whether supply will outlast the next visit or not. User can update dosage or quantity at any time and the calculation updates immediately.

### Secondary
Each medication on the dashboard shows a clear color-coded status indicator (green = enough supply past the next visit; yellow = running close; red = supply runs out before the next visit or medication is near expiry).

### Guardrails
- **Calculation accuracy:** The supply-end date calculation must be arithmetically correct at all times. An incorrect "you have enough" result is a product failure.
- **Mobile browser usability:** The app must be fully functional on a phone-sized screen, even though it is web-only. Typical use case: updating dosage or adding a visit date during or immediately after a doctor's appointment.

### Deferred to v2
- Push or email notifications (low-supply or approaching-expiry alerts)
- Treatment history log

### Timeline
`mvp_weeks: 3` — scoped-down flow (core calculation + auth + CRUD + status indicators, no notifications, no history).

## Functional Requirements

### Authentication
- FR-001: User can register with email and password. Priority: must-have
  > Socrates: Counter-argument "no-auth local app is faster to ship" considered. Rejected: access from phone (at visit) + computer (at home) requires server-side accounts — use case breaks without it.

- FR-002: User can log in and log out of their account. Priority: must-have
  *(covered by FR-001 Socrates above)*

### Specialists
- FR-003: User can add a specialist (name, specialty) whose visits and medications they track. Priority: must-have
  > Socrates: Counter-argument "free-text field per medication/visit is enough" considered. Rejected: reliable medication↔visit linkage requires a managed entity — inconsistent text spelling breaks the core calculation.

### Medications
- FR-004: User can add a medication: name, quantity on hand, printed expiry date, daily dosage (N units/day), assigned specialist. Priority: must-have
  > Socrates: Counter-argument "one medication could be prescribed by multiple specialists" considered. Rejected for v1: in practice the user knows which specialist to see for a given prescription; multi-source edge case deferred to v2.

- FR-005: User enters dosage as a simple daily amount (N units/day). Priority: must-have
  > Socrates: Counter-argument "split mode (N units, M times/day) helps users think naturally (as on a leaflet)" considered. **Partially accepted:** split mode deferred to v2; v1 uses simple daily total only. User converts "2 × 1 pill" → "2/day" themselves for now.

- FR-006: User can add a future dosage change with an effective date (e.g. "from Monday: 1.5 pills/day instead of 1"). Priority: must-have
  > Socrates: Counter-argument "future dosage changes complicate the calculation model — defer to v2" considered. Rejected: notes explicitly call out mid-supply dosage changes as the hardest case existing apps get wrong. Without this FR, the MVP does not solve the core problem.

- FR-007: User can edit a medication (quantity, dosage, expiry date, specialist). Deleting a medication archives it (soft delete — data is retained for v2 history). Priority: must-have
  > Socrates: Counter-argument "hard delete is simpler for MVP" considered. **Overridden:** soft delete chosen to preserve data for v2 history feature; hard delete would destroy records needed downstream.

- FR-008: User can mark a medication as liquid and enter: container capacity, estimated daily consumption, post-opening expiry duration. Priority: must-have
  > Socrates: Counter-argument "estimates without history give false precision — defer" considered. Rejected: even an approximate estimate is better than no calculation for liquid medications; user can refine the estimate over time.

### Doctor Visits
- FR-009: User can add a doctor visit: date, specialist (from defined specialist list). Priority: must-have
  > Socrates: "What happens when a visit passes without a new one entered?" surfaced. Addressed in FR-011: dashboard shows explicit "no visit scheduled" state rather than failing silently.

- FR-010: User can edit and delete a doctor visit. Priority: must-have
  *(covered by FR-009 Socrates above)*

### Dashboard
- FR-011: User sees a dashboard: for each medication — calculated supply-end date, color-coded status (green / yellow / red) relative to the next visit with the specialist assigned to that medication. When no future visit is scheduled for a medication's specialist, the dashboard shows "no visit scheduled" rather than a status. Priority: must-have
  > Socrates: Counter-argument "configurable thresholds for yellow/red" considered. Rejected for v1: sensible hardcoded defaults (e.g. yellow = supply ends ≤ 14 days after the next visit, red = supply ends before visit) are sufficient for MVP; configurable thresholds are v2.

## User Stories

### US-01: Checking supply before a doctor visit
**Given** a user has added medications with current dosages and an upcoming visit to their internist,
**When** they open the dashboard,
**Then** they see — for each medication assigned to that internist — whether their supply will last until that visit, with a color-coded status.

### US-02: Dosage change mid-supply
**Given** a user's doctor increased their daily dosage starting next Monday,
**When** the user adds a future dosage change for that medication with Monday's date,
**Then** the dashboard recalculates the supply-end date using the new dosage from that date, and the status updates accordingly.

## Business Logic

**Domain rule:** For each medication, the app calculates the supply-end date by consuming the current daily dose day by day — applying planned future dosage changes segmentally (old dose until the change date, new dose from the change date onward) — then compares the resulting supply-end date against the nearest scheduled visit with the specialist assigned to that medication.

**Segmental dosage calculation (binding):** When a future dosage change is scheduled, the calculation splits at the change date:
- Days 1…N at the current dose consume units at the current rate.
- Days N+1 onward at the new dose consume units at the new rate.
- The supply-end date is reached when total accumulated units equal the quantity on hand.

**Liquid medication calculation:** For liquid medications, the user enters estimated daily consumption (units/day) and container capacity. The app computes total supply as `(number of containers × capacity per container) / daily consumption`. Post-opening expiry is a separate constraint — the supply-end date is the earlier of the calculated consumption date and the post-opening expiry date.

**No-visit state:** When no future visit is scheduled for a medication's specialist, the supply-end date is still calculated and displayed; the status indicator is replaced with "no visit scheduled" — no green/yellow/red is shown.

**Historical data preservation (binding architectural constraint):** All changes that affect medication state are stored as immutable records with timestamps from day one — not overwritten. This includes: dosage changes (each change creates a new record; prior dosage records are retained), quantity updates (each refill or correction is logged with date), archived medications (soft delete only — FR-007), and past doctor visits (never deleted, only marked as past). The UI for browsing this history is deferred to v2, but the data model must support reconstruction from the first commit.

**Color threshold defaults (v1 hardcoded):**
- Green: supply-end date is more than 14 days after the next specialist visit.
- Yellow: supply-end date is between 0 and 14 days after the next specialist visit.
- Red: supply-end date is before the next specialist visit, OR the printed expiry date (or post-opening expiry) is reached before the next visit.

## Non-Functional Requirements

- **Mobile-first responsiveness:** The app must be fully functional on a phone-sized screen (≥ 320 px viewport width) without horizontal scrolling. Key flows — adding a medication, updating dosage, viewing dashboard — must be completable with one hand on a mobile browser.
- **Perceived response time:** The dashboard must load and display calculated statuses in a way the user perceives as instant (target: under 1 second for a typical medication list of up to 20 items on a standard mobile connection).
- **Data isolation:** A user's medication data, visit dates, and specialist list are accessible only to that authenticated user. No shared links, no public profiles, no cross-account data leakage.

## Non-Goals

- **Treatment history UI in v1:** Historical data is recorded from the first day (see Business Logic constraint), but no history browsing screen is built in v1. Rationale: core value is the supply calculator; history display is a v2 feature once data is accumulated.
- **Push / email notifications in v1:** Low-supply and approaching-expiry alerts are deferred to v2. Rationale: notifications require background jobs or a scheduling service — added complexity before core calculation is validated.
- **Integration with e-prescription or pharmacy systems:** All data is entered manually by the user. No connection to external health IT systems in v1. Rationale: explicit out-of-scope from initial notes; integration complexity is disproportionate to MVP value.
- **Managing medications for other people (children, family members):** One account = one patient's own medications. Multi-patient management is out of scope for v1. Rationale: explicit out-of-scope from initial notes; shared/delegated access adds auth and data model complexity.

## Forward: tech-stack
*(Informational — not a PRD section. Input for /10x-tech-stack-selector.)*
- Product type: web-app (PWA preferred — installable on mobile)
- Language family: not yet decided
- No framework, database, or deployment preferences stated yet

## Open Questions

- Competitive landscape: Are equivalent medication supply calculators already available? If so, what does this app do differently?
