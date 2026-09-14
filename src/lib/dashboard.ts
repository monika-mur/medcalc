import { isPast } from "@/lib/dates";
import type { MedicationView } from "@/lib/db/medications";
import type { Visit } from "@/lib/db/visits";
import { classifySupplyStatus, type SupplyStatus } from "@/lib/supply";

/**
 * The dashboard's grouping rule, beside the engine rather than inline in
 * `dashboard.astro`. It is a domain rule with real edge cases — a specialist
 * with no upcoming visit, a medication whose supply cannot be calculated at all
 * — and those belong somewhere a reader can find them.
 *
 * Everything here is pure. `today` is resolved once by the page and passed in;
 * nothing in this file reads a clock.
 */

/**
 * What a card says, in one value.
 *
 * The first three come straight from `MedicationView.status` and short-circuit
 * the supply comparison: a medication with no dosage row has nothing to
 * calculate, a stopped one consumes nothing, and an empty one has already run
 * out. Only the rest reach `classifySupplyStatus`.
 *
 * Reusing `deriveStatus`'s precedence rather than inventing a second one is what
 * keeps `/medications` and `/dashboard` agreeing about the same row.
 */
export type CardState = "no_dosage" | "stopped" | "out_of_stock" | SupplyStatus;

export interface DashboardCard {
  medication: MedicationView;
  state: CardState;
}

export interface SpecialistGroup {
  specialist: { id: string; name: string; specialty: string };
  /** The soonest visit that is not past, or `null` when none is scheduled. */
  nextVisitDate: string | null;
  cards: DashboardCard[];
}

/**
 * The soonest `visit_date` for this specialist that is not past.
 *
 * Uses `isPast`, so "upcoming" here is literally what `/visits` renders — a
 * visit dated today counts as next on both screens. Defining it twice is how
 * they end up disagreeing about one row.
 */
export function nextVisitFor(visits: Visit[], specialistId: string, today: string): string | null {
  let soonest: string | null = null;
  for (const visit of visits) {
    if (visit.specialist_id !== specialistId) continue;
    if (isPast(visit.visit_date, today)) continue;
    if (soonest === null || visit.visit_date < soonest) {
      soonest = visit.visit_date;
    }
  }
  return soonest;
}

/**
 * **Exhaustive on purpose.** This used to end in a `default:` that fell through
 * to `classifySupplyStatus`, which meant a new `MedicationStatus` variant got a
 * card state silently rather than failing the build — and since `CardState` is
 * structurally independent of `MedicationStatus`, nothing else in the tree would
 * have caught it either. That is how S-04 handed a defect to S-05: `not_started`
 * would have rendered as whatever the fall-through produced, with no compiler
 * error anywhere. The `never` assignment below is the guard; adding a variant
 * now stops the build here.
 *
 * **`not_started` deliberately joins `active` rather than getting a quiet state
 * of its own.** The tempting move is to treat "nobody is consuming this yet"
 * like `not_used` → `stopped`, but the engine disagrees and it is right to:
 * with stock on hand and a dosage effective in a week, the zero-dose branch
 * consumes nothing across the first span, the walk reaches the breakpoint and
 * returns a real `supplyEndDate`. A quiet card would throw that answer away, so
 * a medication that runs out before the next visit would read neutral — the
 * "you have enough" over-report the PRD names as a product failure. `not_used`
 * is different because its consumption is zero indefinitely; here it starts on
 * a known date.
 */
function cardStateFor(medication: MedicationView, nextVisitDate: string | null): CardState {
  switch (medication.status) {
    case "no_dosage":
      return "no_dosage";
    case "not_used":
      return "stopped";
    case "out_of_stock":
      return "out_of_stock";
    // `archived` never reaches here — `buildDashboard` filters it out before
    // calling — but the switch has to be total for the guard below to work.
    case "active":
    case "not_started":
    case "archived":
      return classifySupplyStatus(medication.supply_end_date, nextVisitDate);
    default: {
      const unhandled: never = medication.status;
      throw new Error(`Unhandled medication status: ${String(unhandled)}`);
    }
  }
}

/**
 * Within a group, most urgent first.
 *
 * `no_dosage` sorts above everything, `out_of_stock` included: the other states
 * are answers, and this one is the app admitting it has none. An unknowable
 * medication is worse than a known-empty one, and it is the only state on the
 * screen meaning "something is wrong with your data" rather than "here is your
 * situation".
 */
const CARD_ORDER: Record<CardState, number> = {
  no_dosage: 0,
  out_of_stock: 1,
  red: 2,
  yellow: 3,
  green: 4,
  no_visit: 5,
  stopped: 6,
};

export function buildDashboard(medications: MedicationView[], visits: Visit[], today: string): SpecialistGroup[] {
  const groups = new Map<string, SpecialistGroup>();

  for (const medication of medications) {
    // Archived is the user's explicit "hide this", so it never reaches the
    // dashboard — including the group header, which is why the filter is here
    // rather than on the card list below.
    if (medication.archived_at !== null) continue;

    let group = groups.get(medication.specialist.id);
    if (!group) {
      group = {
        specialist: medication.specialist,
        nextVisitDate: nextVisitFor(visits, medication.specialist.id, today),
        cards: [],
      };
      groups.set(medication.specialist.id, group);
    }
    group.cards.push({ medication, state: cardStateFor(medication, group.nextVisitDate) });
  }

  for (const group of groups.values()) {
    group.cards.sort(
      (a, b) => CARD_ORDER[a.state] - CARD_ORDER[b.state] || a.medication.name.localeCompare(b.medication.name),
    );
  }

  // Soonest visit first; a specialist with nothing scheduled sorts last rather
  // than being dropped — "no visit scheduled" is a state FR-009 asks for, not an
  // absence to hide.
  return [...groups.values()].sort((a, b) => {
    if (a.nextVisitDate !== b.nextVisitDate) {
      if (a.nextVisitDate === null) return 1;
      if (b.nextVisitDate === null) return -1;
      return a.nextVisitDate < b.nextVisitDate ? -1 : 1;
    }
    return a.specialist.name.localeCompare(b.specialist.name);
  });
}
