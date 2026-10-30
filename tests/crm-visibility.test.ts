/**
 * Visibility-filter override attempts, run for real: the query the CRM routes build (scopedQuery + crmVisibilityFilter)
 * is executed against a throwaway local MongoDB. The routes themselves deny Dealers and Sales Executives today, so the
 * crafted-request cases can only be shown at the query level: they prove that a requested filter (another dealer's id,
 * another salesperson, a search term) can only narrow what the caller may see.
 *
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/crm-visibility.test.ts
 *
 * Uses 127.0.0.1:27017 only (the same throwaway server the other tests use); never reads .env.local.
 */
import assert from "node:assert/strict";
import { MongoClient } from "mongodb";
import { crmVisibilityFilter, scopedQuery } from "../src/lib/crmService";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};

async function main() {
  const client = new MongoClient("mongodb://127.0.0.1:27017", { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  const dbName = `crm_visibility_test_${Date.now()}`;
  const leads = client.db(dbName).collection("leads");
  try {
    const base = { phone: "9000000000", status: "new", createdBy: 1 };
    await leads.insertMany([
      { _id: "L1" as never, companyId: 7, customerName: "Alpha Villa", dealerId: 9, assignedSalesId: null, ...base },
      { _id: "L2" as never, companyId: 7, customerName: "Secret Corp", dealerId: 10, assignedSalesId: null, ...base },
      { _id: "L3" as never, companyId: 7, customerName: "Sales Own", dealerId: null, assignedSalesId: 42, ...base },
      { _id: "L4" as never, companyId: 7, customerName: "Sales Created", dealerId: null, assignedSalesId: null, ...base, createdBy: 42 },
      { _id: "L5" as never, companyId: 7, customerName: "Secret Sales Lead", dealerId: null, assignedSalesId: 43, ...base },
      { _id: "L6" as never, companyId: 8, customerName: "Secret Other Company", dealerId: 9, assignedSalesId: 42, ...base },
    ]);
    const ids = async (query: Record<string, unknown>) => (await leads.find(query).toArray()).map((doc) => String(doc._id)).sort();
    const search = (term: string) => ({ $or: [{ customerName: new RegExp(term, "i") }, { phone: new RegExp(term, "i") }] });

    // Control: the pattern the routes used to have (assigning the parameter over the rule) really does leak.
    const leaky: Record<string, unknown> = { companyId: 7, ...crmVisibilityFilter({ role: "dealer", userId: 9 }) };
    leaky.dealerId = 10;
    assert.deepEqual(await ids(leaky), ["L2"], "control: overwriting the rule with ?dealerId=10 would expose another dealer's lead");

    // Dealer 9
    const dealer = (filters: Array<Record<string, unknown>>) => scopedQuery(7, crmVisibilityFilter({ role: "dealer", userId: 9 }), filters);
    assert.deepEqual(await ids(dealer([])), ["L1"], "dealer sees only own leads");
    assert.deepEqual(await ids(dealer([{ dealerId: 10 }])), [], "crafted ?dealerId=<another dealer> returns nothing");
    assert.deepEqual(await ids(dealer([{ dealerId: 9 }])), ["L1"], "own id still works");
    assert.deepEqual(await ids(dealer([{ assignedSalesId: 43 }])), [], "crafted ?assignedSalesId cannot reach another lead");
    assert.deepEqual(await ids(dealer([search("Secret")])), [], "searching for another dealer's lead finds nothing");
    assert.deepEqual(await ids(dealer([{ dealerId: 10 }, search("Secret")])), [], "filter and search together");
    assert.deepEqual(await ids(dealer([{ status: "new" }, search("Alpha")])), ["L1"], "normal filters narrow as expected");
    pass("a dealer cannot widen their view with another dealer's id, a salesperson id or a search term");

    // Sales Executive 42 (visibility is an $or, the case a plain assignment broke)
    const sales = (filters: Array<Record<string, unknown>>) => scopedQuery(7, crmVisibilityFilter({ role: "sales_executive", userId: 42 }), filters);
    assert.deepEqual(await ids(sales([])), ["L3", "L4"], "a salesperson sees assigned and created leads");
    assert.deepEqual(await ids(sales([search("Secret")])), [], "searching for someone else's lead finds nothing (the old $or overwrite leaked L5)");
    assert.deepEqual(await ids(sales([search("Sales")])), ["L3", "L4"], "searching own leads works");
    assert.deepEqual(await ids(sales([{ assignedSalesId: 43 }])), [], "crafted ?assignedSalesId=43 finds nothing");
    assert.deepEqual(await ids(sales([{ dealerId: 9 }])), [], "crafted ?dealerId finds nothing");
    pass("a sales executive's view survives search and crafted filters (the $or visibility rule is never replaced)");

    // Admin roles and company isolation
    const admin = (filters: Array<Record<string, unknown>>) => scopedQuery(7, crmVisibilityFilter({ role: "company_owner", userId: 1 }), filters);
    assert.deepEqual(await ids(admin([])), ["L1", "L2", "L3", "L4", "L5"], "an admin sees the whole company");
    assert.deepEqual(await ids(admin([{ dealerId: 10 }])), ["L2"], "and may filter");
    assert.deepEqual(await ids(admin([search("Secret")])), ["L2", "L5"], "search finds company leads only");
    assert.ok(!(await ids(admin([search("Other Company")]))).includes("L6"), "another company's lead never appears");
    assert.deepEqual(await ids(scopedQuery(7, {}, [])), ["L1", "L2", "L3", "L4", "L5"]);
    pass("admins see the whole company, filters narrow, and no query ever reaches another company's records");
  } finally {
    await client.db(dbName).dropDatabase();
    await client.close();
  }
}

main()
  .then(() => console.log(`\n${count} passed`))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
