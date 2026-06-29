---
project: MedCalc
version: 1
status: draft
created: 2026-06-04
context_type: greenfield
product_type: web-app
target_scale:
  users: medium
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
---

## Vision & Problem Statement

An individual who takes multiple chronic medications cannot reliably answer the question "do I need prescriptions renewed at my next doctor visit?" without manual arithmetic across medication quantities, expiry dates, current dosages, possible mid-supply dosage changes, and the dates of upcoming appointments with each prescribing specialist. When a doctor adjusts a dosage partway through an existing supply, this calculation becomes particularly error-prone: the supply-end date shifts forward or backward, and the user has no tool that accounts for the change automatically. The practical cost is either arriving at a doctor's visit unprepared, scrambling for a last-minute prescription, or scheduling an unnecessary appointment.

Most medication-management tools are reminder apps — they tell the user when to take a pill, not whether they have enough to last until the next visit. The hard case — a dosage change partway through an existing supply, across visits to multiple specialists, with some medications having post-opening expiry constraints — remains unaddressed. MedCalc treats the supply question as the primary domain problem and treats reminders as a secondary concern for a later version.

## User & Persona

**Primary persona:** An individual adult managing a stable or semi-stable set of chronic medications (e.g. blood pressure, thyroid, diabetes, psychiatric medications), who may also add temporary medications periodically. This person visits doctors on a regular schedule — monthly, quarterly — and often sees multiple specialists (e.g. an internist and an ophthalmologist) each of whom may prescribe different medications.

**Moment of use:** The user reaches for MedCalc before or during a doctor's appointment to answer the question "which medications do I need a new prescription for today?" — typically on a phone. They also use it at home on a computer to update dosages or add medications after a visit.

**Key behaviors:**
- Adds a medication when first prescribed; updates the quantity after filling a prescription
- Updates or pre-schedules dosage changes when a doctor adjusts them, including mid-supply changes with a future effective date
- Checks the dashboard before each doctor's appointment to see which prescriptions to request
- Tracks medications separately by specialist to know which doctor to ask for each renewal

## Success Criteria

### Primary
The user adds one or more medications (name, quantity on hand, expiry date, daily dosage, prescribing specialist) and one or more upcoming doctor visit dates (each linked to a specialist). The app calculates and displays — for each medication — the date until which the current supply lasts and whether that supply will outlast the next visit with the appropriate specialist. The user can update dosage (including future dosage changes with an effective date) or quantity at any time, and the calculation updates immediately.

### Secondary
Each medication on the dashboard shows a color-coded status indicator: green (supply ends more than 14 days after the next specialist visit), yellow (supply ends within 14 days of the next visit), red (supply ends before the next visit, or the medication's expiry date is reached before the next visit).

### Guardrails
- **Calculation accuracy:** The supply-end date calculation is arithmetically correct at all times. An incorrect "you have enough" result is a product failure regardless of how smooth the rest of the experience is.
- **Mobile browser usability:** All primary flows — viewing the dashboard, adding a medication, updating dosage or quantity, adding a visit date — are completable on a phone-sized screen in a mobile browser without horizontal scrolling.

## User Stories

### US-01: Checking supply before a doctor visit

- **Given** a user who has added medications with current dosages and has an upcoming visit to their internist scheduled
- **When** they open the dashboard
- **Then** they see — for each medication assigned to that internist — the calculated supply-end date and a color-coded status showing whether supply will last until the visit

#### Acceptance Criteria
- Each medication assigned to the internist displays its supply-end date
- Status is green, yellow, or red per the hardcoded thresholds
- Medications assigned to other specialists are also visible on the dashboard, each linked to their own specialist's next visit date
- If no visit is scheduled for a medication's specialist, the dashboard shows "no visit scheduled" in place of the color status

### US-02: Dosage change mid-supply

- **Given** a user's doctor has increased their daily dosage, effective starting next Monday
- **When** the user adds a future dosage change for that medication with the Monday effective date
- **Then** the dashboard immediately recalculates the supply-end date — using the current dosage until Sunday, the new dosage from Monday — and updates the color status accordingly

#### Acceptance Criteria
- The recalculated supply-end date reflects the segmental calculation: old dose consumed through the day before the change date, new dose from the change date onward
- The color status updates to reflect the new supply-end date relative to the next visit
- The dosage change is stored with a timestamp

## Functional Requirements

### Authentication
- FR-001: User can register with email and password. Priority: must-have
  > Socrates: Counter-argument "no-auth local app is faster to ship" considered. Rejected: access from phone (at visit) + computer (at home) requires server-side accounts — the core use case breaks without cross-device access.

- FR-002: User can log in and log out of their account. Priority: must-have
  *(covered by FR-001 Socrates above)*

### Specialists
- FR-003: User can add a specialist (name, specialty) to track visits and medications for. Priority: must-have
  > Socrates: Counter-argument "a free-text field per medication/visit is enough" considered. Rejected: reliable medication↔visit linkage requires a managed entity — inconsistent spelling of specialist names breaks the core calculation.

### Medications
- FR-004: User can add a medication: name, quantity on hand, printed expiry date, daily dosage (units/day), assigned specialist. Priority: must-have
  > Socrates: Counter-argument "one medication could be prescribed by multiple specialists" considered. Rejected for v1: in practice the user knows which specialist to see for a given prescription; the multi-source edge case is deferred to v2.

- FR-005: User enters dosage as a simple daily total (units/day). Priority: must-have
  > Socrates: Counter-argument "split entry mode — N units, M times/day — helps users think naturally, as on a leaflet" considered. **Partially accepted:** split mode is deferred to v2; v1 accepts a single daily total only. Users who think in doses-per-administration convert manually for now.

- FR-006: User can add a future dosage change with an effective date (e.g. "from Monday: 1.5 units/day instead of 1"). Priority: must-have
  > Socrates: Counter-argument "future dosage changes complicate the calculation model — defer to v2" considered. Rejected: mid-supply dosage changes are the hardest case existing medication apps get wrong. Omitting this FR means the MVP does not solve the core stated problem.

- FR-007: User can edit a medication (quantity on hand, dosage, expiry date, assigned specialist). When a user removes a medication, it is archived rather than permanently deleted — the medication's data is retained for the v2 history feature. Priority: must-have
  > Socrates: Counter-argument "permanent deletion is simpler for MVP" considered. **Overridden:** archival chosen because permanent deletion would destroy records required by the v2 history feature.

- FR-008: User can mark a medication as liquid and enter: container capacity, estimated daily consumption, post-opening expiry duration. Priority: must-have
  > Socrates: Counter-argument "estimates without historical data give false precision — defer" considered. Rejected: even an approximate estimate enables a calculation where otherwise none is possible for liquid medications; the user can refine the estimate over time.

### Doctor Visits
- FR-009: User can add a doctor visit: date, specialist (selected from the user's defined specialist list). Priority: must-have
  > Socrates: "What happens when a visit passes and no new one has been entered?" surfaced. Addressed in FR-011: the dashboard displays "no visit scheduled" rather than silently failing or showing a stale status.

- FR-010: User can edit and delete a doctor visit. Priority: must-have
  *(covered by FR-009 Socrates above)*

### Dashboard
- FR-011: User sees a dashboard listing each medication with its calculated supply-end date and a color-coded status (green / yellow / red) relative to the next scheduled visit with the assigned specialist. When no future visit is scheduled for a medication's specialist, the dashboard shows "no visit scheduled" in place of the status indicator. Priority: must-have
  > Socrates: Counter-argument "color thresholds should be user-configurable" considered. Rejected for v1: hardcoded defaults (green = supply ends more than 14 days after next visit; yellow = within 14 days; red = before visit or before medication expiry) are sufficient for MVP. Configurable thresholds are v2.

## Non-Functional Requirements

- The app is fully usable on a phone-sized screen (viewport ≥ 320 px wide) without horizontal scrolling. The primary flows — dashboard view, adding a medication, updating dosage or quantity, adding a visit — are completable with one hand in a mobile browser.
- The dashboard loads and displays all calculated supply statuses within one second for a list of up to 20 medications on a standard mobile network connection.
- A user's medication data, visit dates, and specialist list are accessible only to that authenticated user. No shared-link access, no public profiles, and no cross-account data visibility are permitted.

## Business Logic

For each medication, the app determines whether the user's current supply will outlast the next scheduled visit with the prescribing specialist by calculating the supply-end date — consuming daily doses day by day, applying any future dosage changes at their effective dates — and comparing it to the visit date.

The user provides: quantity on hand, the daily dosage in effect today, and optionally one or more future dosage changes (each specifying a new daily quantity and an effective date). When a future dosage change is scheduled, the calculation is segmental: the current dosage is consumed from today through the day before the change date, and the new dosage is consumed from the change date onward. The supply-end date is the day on which the accumulated consumption equals the quantity on hand.

For liquid medications (e.g. eye drops), the user additionally provides the container capacity and an estimated daily consumption. Total supply is calculated as: number of containers × capacity per container, divided by estimated daily consumption. Post-opening expiry is an independent constraint: the supply-end date for a liquid medication is the earlier of the calculated consumption date and the post-opening expiry date.

All medication state changes — dosage adjustments, quantity updates, archival — are recorded with timestamps from the first day the product is used. This record must be complete enough that a full usage history can be reconstructed at any point in time. The interface for browsing that history is a v2 feature; the underlying record is a v1 requirement.

**Color status thresholds (v1, hardcoded):**
- Green: supply-end date is more than 14 days after the next specialist visit.
- Yellow: supply-end date is within 14 days of the next specialist visit (supply ends ≤ 14 days after the visit date).
- Red: supply-end date is before the next specialist visit, OR the medication's printed expiry date (or post-opening expiry, for liquid medications) is reached before the next visit.
- No status: no future visit is scheduled for this medication's specialist.

## Access Control

Authentication: email and password. Each user registers with a unique email address and a password. A user's session grants access only to their own data.

Role model: flat. Every registered account is a regular user with identical capabilities over their own data and no access to any other account's data. No admin, caregiver, or patient-specific roles exist in v1.

Unauthenticated access: all application routes require authentication. An unauthenticated request to any application route is redirected to the login screen.

## Non-Goals

- **Treatment history browsing UI in v1:** Medication state changes are recorded from the first day of operation (see Business Logic), but no screen for browsing that history is built in v1. The core value is the supply calculator; history display is a v2 feature once data has accumulated.
- **Push or email notifications in v1:** Alerts for low supply or approaching expiry dates are deferred to v2. Introducing background-job infrastructure before the core calculation is validated adds disproportionate complexity to the MVP.
- **Integration with e-prescription or pharmacy systems:** All data is entered manually by the user. No connection to external health IT systems is planned for v1.
- **Managing medications for other people:** One account covers one user's own medications. Multi-patient management, caregiver delegation, and shared accounts are out of scope for v1.
- **Split dosage entry mode (N units M times/day):** v1 accepts a single daily total only. Users who think in doses-per-administration convert manually; the split-entry mode is v2.
- **Configurable color-status thresholds:** Green / yellow / red thresholds are hardcoded in v1. User-configurable thresholds are v2.

## Open Questions

1. **Competitive landscape:** Are equivalent medication supply calculators already available? If so, what does MedCalc do differently or better? Owner: user. Block: soft — does not block MVP development, but affects positioning and scope-validation decisions before launch.
