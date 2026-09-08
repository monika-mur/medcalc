# Engine verification harness (scratch)

Not part of the build. Kept as `.md` deliberately: `tsconfig.json` includes `**/*`,
so a `.ts` file under `context/` would be type-checked and linted, and this script
imports with explicit `.ts` extensions that only Node's type-stripping accepts.

Ran 32/32 green against Phase 1's modules on 2026-09-06. It is the seed for the
close-out item `follow-ups/supply-engine-tests.md` (Progress C.1).

## How to run

```bash
TMP=$(mktemp -d)
cp src/lib/dates.ts src/lib/decimal.ts src/lib/supply.ts "$TMP/"
sed -i 's#"@/lib/dates"#"./dates.ts"#; s#"@/lib/decimal"#"./decimal.ts"#' "$TMP/supply.ts"
# save the script below as "$TMP/check.ts", then:
node --experimental-strip-types "$TMP/check.ts"
```

## The script

```ts
import { computeSupply, classifySupplyStatus } from "./supply.ts";
import { addDays, daysBetween } from "./dates.ts";
import { floorDivide, subtractExact, clampScale } from "./decimal.ts";

let fails = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) fails += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n        got ${a}\n        want ${e}`}`);
}

const FAR = "2027-01-01";

console.log("--- worked examples ---");
eq("1 single refill, constant dose",
  computeSupply({ events: [{ quantity_delta: 30, occurred_on: "2026-09-01" }],
    dosages: [{ daily_dosage: 1, effective_date: "2026-09-01" }], expiryDate: FAR, today: "2026-09-06" }),
  { supplyEndDate: "2026-09-30", supplyEndReason: "consumption", projectedQuantity: 25 });

eq("2 two refills (breaks a last-event anchor)",
  computeSupply({ events: [{ quantity_delta: 30, occurred_on: "2026-09-01" }, { quantity_delta: 30, occurred_on: "2026-09-11" }],
    dosages: [{ daily_dosage: 1, effective_date: "2026-09-01" }], expiryDate: FAR, today: "2026-09-06" }).supplyEndDate,
  "2026-10-30");

eq("3 dosage change between events",
  computeSupply({ events: [{ quantity_delta: 30, occurred_on: "2026-09-01" }],
    dosages: [{ daily_dosage: 1, effective_date: "2026-09-01" }, { daily_dosage: 2, effective_date: "2026-09-11" }],
    expiryDate: FAR, today: "2026-09-06" }).supplyEndDate,
  "2026-09-20");

eq("4 expiry cap",
  computeSupply({ events: [{ quantity_delta: 100, occurred_on: "2026-09-01" }],
    dosages: [{ daily_dosage: 1, effective_date: "2026-09-01" }], expiryDate: "2026-10-01", today: "2026-09-06" }),
  { supplyEndDate: "2026-10-01", supplyEndReason: "expiry", projectedQuantity: 95 });

eq("5 breakpoint past the expiry cap",
  computeSupply({ events: [{ quantity_delta: 100, occurred_on: "2026-09-01" }],
    dosages: [{ daily_dosage: 1, effective_date: "2026-09-01" }, { daily_dosage: 3, effective_date: "2026-09-20" }],
    expiryDate: "2026-09-15", today: "2026-09-06" }),
  { supplyEndDate: "2026-09-15", supplyEndReason: "expiry", projectedQuantity: 95 });

eq("6 exhaustion then refill",
  computeSupply({ events: [{ quantity_delta: 30, occurred_on: "2026-09-01" }, { quantity_delta: 30, occurred_on: "2026-10-15" }],
    dosages: [{ daily_dosage: 1, effective_date: "2026-09-01" }], expiryDate: FAR, today: "2026-10-20" }),
  { supplyEndDate: "2026-11-13", supplyEndReason: "consumption", projectedQuantity: 25 });

console.log("--- engine edges ---");
eq("no events", computeSupply({ events: [], dosages: [], expiryDate: FAR, today: "2026-09-06" }),
  { supplyEndDate: null, supplyEndReason: null, projectedQuantity: 0 });

eq("no dosage rows at all (dose 0, stock intact)",
  computeSupply({ events: [{ quantity_delta: 30, occurred_on: "2026-09-01" }], dosages: [], expiryDate: FAR, today: "2026-09-06" }),
  { supplyEndDate: FAR, supplyEndReason: "expiry", projectedQuantity: 30 });

eq("5 -> 0 -> 5, exhausted exactly at the pause",
  computeSupply({ events: [{ quantity_delta: 50, occurred_on: "2026-09-01" }],
    dosages: [{ daily_dosage: 5, effective_date: "2026-09-01" }, { daily_dosage: 0, effective_date: "2026-09-11" },
              { daily_dosage: 5, effective_date: "2026-09-21" }], expiryDate: FAR, today: "2026-09-06" }).supplyEndDate,
  "2026-09-10");

eq("today before the first event (UTC skew)",
  computeSupply({ events: [{ quantity_delta: 30, occurred_on: "2026-09-07" }],
    dosages: [{ daily_dosage: 1, effective_date: "2026-09-07" }], expiryDate: FAR, today: "2026-09-06" }).projectedQuantity, 0);

eq("expiry precedes the first event",
  computeSupply({ events: [{ quantity_delta: 30, occurred_on: "2026-09-01" }],
    dosages: [{ daily_dosage: 1, effective_date: "2026-09-01" }], expiryDate: "2026-01-01", today: "2026-09-06" }),
  { supplyEndDate: "2026-01-01", supplyEndReason: "expiry", projectedQuantity: 0 });

eq("expired in the past, walk still reaches today for the projection",
  computeSupply({ events: [{ quantity_delta: 100, occurred_on: "2026-09-01" }],
    dosages: [{ daily_dosage: 1, effective_date: "2026-09-01" }], expiryDate: "2026-09-15", today: "2026-09-30" }),
  { supplyEndDate: "2026-09-15", supplyEndReason: "expiry", projectedQuantity: 71 });

eq("exhaustion exactly on expiry stays consumption",
  computeSupply({ events: [{ quantity_delta: 30, occurred_on: "2026-09-01" }],
    dosages: [{ daily_dosage: 1, effective_date: "2026-09-01" }], expiryDate: "2026-09-30", today: "2026-09-06" }),
  { supplyEndDate: "2026-09-30", supplyEndReason: "consumption", projectedQuantity: 25 });

eq("fractional dose 0.9 on hand at 0.3/day",
  computeSupply({ events: [{ quantity_delta: 0.9, occurred_on: "2026-09-01" }],
    dosages: [{ daily_dosage: 0.3, effective_date: "2026-09-01" }], expiryDate: FAR, today: "2026-09-01" }).supplyEndDate,
  "2026-09-03");

console.log("--- classifier boundaries ---");
eq("supplyEnd === visit -> red", classifySupplyStatus("2026-09-20", "2026-09-20"), "red");
eq("visit + 1 -> yellow", classifySupplyStatus("2026-09-21", "2026-09-20"), "yellow");
eq("visit + 14 -> yellow", classifySupplyStatus("2026-10-04", "2026-09-20"), "yellow");
eq("visit + 15 -> green", classifySupplyStatus("2026-10-05", "2026-09-20"), "green");
eq("before visit -> red", classifySupplyStatus("2026-09-19", "2026-09-20"), "red");
eq("no visit -> no_visit", classifySupplyStatus("2026-09-20", null), "no_visit");
eq("null supply-end -> red", classifySupplyStatus(null, "2026-09-20"), "red");

console.log("--- primitives ---");
eq("0.9 / 0.3 floor", floorDivide(0.9, 0.3), 3);
eq("0.3 - 0.1 exact", subtractExact(0.3, 0.1), 0.2);
eq("clampScale seven places", clampScale(0.1234567), 0.123457);
eq("addDays month boundary", addDays("2026-01-31", 1), "2026-02-01");
eq("addDays year boundary", addDays("2026-12-31", 1), "2027-01-01");
eq("addDays negative", addDays("2026-03-01", -1), "2026-02-28");
eq("leap 2024", addDays("2024-02-28", 1), "2024-02-29");
eq("2100 not leap", addDays("2100-02-28", 1), "2100-03-01");
eq("2000 leap", addDays("2000-02-28", 1), "2000-02-29");
eq("daysBetween signed", daysBetween("2026-09-10", "2026-09-01"), -9);

// Differential run against Date, several thousand consecutive days.
let drift = 0;
const base = Date.UTC(2020, 0, 1);
for (let i = 0; i < 5000; i += 1) {
  const expected = new Date(base + i * 86400000).toISOString().slice(0, 10);
  if (addDays("2020-01-01", i) !== expected) drift += 1;
}
eq("addDays matches Date over 5000 consecutive days", drift, 0);

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
```
