/**
 * Which time zone names are accepted for a person, and how they are written.
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/time-zones.test.ts
 */
import assert from "node:assert/strict";
import { FOLLOW_UP_TIME_ZONE, isValidTimeZone, resolveFollowUpTimeZone } from "../src/lib/followUps";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};

assert.equal(FOLLOW_UP_TIME_ZONE, "Asia/Kolkata");
for (const name of ["Asia/Kolkata", "Asia/Calcutta", "America/New_York", "America/Argentina/Buenos_Aires", "Etc/GMT+5", "Pacific/Kiritimati", "Europe/London", "UTC"]) {
  assert.equal(isValidTimeZone(name), true, name);
}
for (const bad of ["+05:30", "-08:00", "IST", "EST", "PST8PDT", "Mars/Olympus", "", "  ", "Asia/Kolkata ", "Asia", "/Asia/Kolkata", 5, null, undefined, {}]) {
  assert.equal(isValidTimeZone(bad), false, String(bad));
}
pass("only real Area/Location zone names (and UTC) are accepted; offsets, abbreviations, unknown or malformed names are not");

assert.equal(resolveFollowUpTimeZone("Asia/Kolkata"), "Asia/Kolkata");
assert.equal(resolveFollowUpTimeZone("Asia/Calcutta"), "Asia/Kolkata", "the same zone always gets the same name, whatever the runtime calls it");
assert.equal(resolveFollowUpTimeZone("asia/kolkata"), "Asia/Kolkata", "case is corrected");
assert.equal(resolveFollowUpTimeZone("europe/london"), "Europe/London");
assert.equal(resolveFollowUpTimeZone("Etc/UTC"), "UTC");
for (const fallback of [null, undefined, "", "IST", "+05:30", "Nowhere/Land", 7]) assert.equal(resolveFollowUpTimeZone(fallback), "Asia/Kolkata", String(fallback));
pass("a chosen zone is written one standard way; nothing chosen or anything invalid means Asia/Kolkata");

console.log(`\nALL ${count} TIME ZONE TESTS PASSED!`);
