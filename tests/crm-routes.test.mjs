/**
 * CRM through the real API (production-mode server + throwaway local MongoDB): Convert (ownership, dealer discount and
 * earning, audit trail, simultaneous clicks, stale lost data), activity access control, assignee validation,
 * duplicate customers and leads (any phone format, simultaneous requests), the real Negotiation status and notes that
 * are never overwritten, quotation totals on the customer profile, and lead stages following their quotation
 * (sent / approved / rejected).
 *
 *   node tests/crm-routes.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;

try {
  server = await startIsolatedServer("crm-routes", [
    { _id: 1, email: "owner@example.com", role: "company_owner", name: "Owner", companyId: 10 },
    { _id: 2, email: "salesa@example.com", role: "sales_executive", name: "Sales A", companyId: 10 },
    { _id: 4, email: "dealerd@example.com", role: "dealer", name: "Dealer D", discountAllocationPercent: 10, companyId: 10 },
    { _id: 5, email: "dealere@example.com", role: "dealer", name: "Dealer E", discountAllocationPercent: 10, companyId: 10 },
    { _id: 6, email: "dealerx@example.com", role: "dealer", name: "Dealer X (other company)", discountAllocationPercent: 10, companyId: 20 },
    { _id: 7, email: "limited@example.com", role: "configurable_admin", name: "Limited Admin", permissions: ["leads:read", "leads:manage"], companyId: 10 },
    { _id: 8, email: "owner2@example.com", role: "company_owner", name: "Owner Two", companyId: 20 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  // A quotation is marked sent together with its PDF (multipart "pdf").
  const markSent = async (cookie, id, label = id) => {
    const form = new FormData();
    form.append("pdf", new Blob([Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`)], { type: "application/pdf" }), "q.pdf");
    const res = await fetch(`${baseUrl}/api/quotations/${id}/mark-sent`, { method: "POST", headers: { Cookie: cookie }, body: form });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, data: json?.data, text };
  };
  const now = new Date();
  for (const [cid, base, name] of [[10, 100, "Acme Homes"], [20, 200, "Other Co"]]) {
    await db.collection("companies").insertOne({ _id: cid, name, slug: `c${cid}`, status: "active", phone: "1111111111", address: "St", gstNumber: null, email: null, logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
    await db.collection("categories").insertOne({ _id: base + 1, companyId: cid, name: "Switches", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [] });
    await db.collection("roomtypes").insertOne({ _id: base + 1, companyId: cid, name: "Living Room", isActive: true, sortOrder: 1 });
    await db.collection("housetypes").insertOne({ _id: base + 1, companyId: cid, name: "2 BHK", isActive: true, sortOrder: 1 });
    await db.collection("housetyperoomtemplates").insertOne({ _id: base + 1, companyId: cid, houseTypeId: base + 1, roomTypeId: base + 1, defaultCount: 1, sortOrder: 1 });
    await db.collection("products").insertOne({ _id: base + 1, companyId: cid, name: "Smart Switch", code: `P-${base}`, type: "switch_board", categoryId: base + 1, unit: "pcs", isActive: true, sortOrder: 1, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now });
    await db.collection("productvariants").insertOne({ _id: base + 1, companyId: cid, productId: base + 1, variantCode: `V-${base}`, config: {}, price: Decimal128.fromString("1000.00"), priceWithoutTax: Decimal128.fromString("1000.00"), taxPercent: Decimal128.fromString("0.00"), isActive: true, sortOrder: 1 });
  }
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const c = {
    owner: await login("owner@example.com", "admin"),
    limited: await login("limited@example.com", "admin"),
    owner2: await login("owner2@example.com", "admin"),
    dealerD: await login("dealerd@example.com", "user"),
    dealerE: await login("dealere@example.com", "user"),
  };
  const arr = (r) => { const d = r.json?.data ?? r.data; if (Array.isArray(d)) return d; if (Array.isArray(d?.data)) return d.data; return []; };
  const mk = async (body, who = c.owner) => {
    const r = await api(who, "POST", "/api/crm/leads", body);
    assert.equal(r.status, 201, `create lead ${body.customerName}: ${r.text?.slice(0, 200)}`);
    return { id: r.data.id, r };
  };
  const leadDoc = (id) => db.collection("leads").findOne({ _id: id });
  const stageOf = async (leadId) => {
    for (const stage of arr(await api(c.owner, "GET", "/api/crm/pipeline"))) if (stage.items.some((i) => i.leadId === leadId)) return stage.id;
    return null;
  };
  const addItem = async (qid, base) => {
    const room = (await api(c.owner, "GET", `/api/quotations/${qid}`)).data.rooms[0];
    const res = await api(c.owner, "POST", `/api/quotations/${qid}/items`, { quotationRoomId: room.id, productId: base + 1, productVariantId: base + 1, quantity: 2 });
    assert.equal(res.status, 201, res.text?.slice(0, 200));
  };

  // ═══ 1. Convert ═══
  const dealerLead = await mk({ customerName: "Dealer Lead", phone: "9876500003", dealerId: 4, assignedSalesId: 2 });
  const conv = await api(c.owner, "POST", `/api/crm/leads/${dealerLead.id}/convert`, { houseTypeId: 101 });
  assert.equal(conv.status, 200, conv.text?.slice(0, 200));
  const converted = await db.collection("quotations").findOne({ _id: conv.data.quotationId });
  const normal = await api(c.dealerD, "POST", "/api/quotations", { clientName: "Normal Dealer Quote" });
  assert.equal(normal.status, 201);
  const normalDoc = await db.collection("quotations").findOne({ _id: normal.data.id ?? normal.data._id });
  assert.equal(converted.dealerId, 4);
  assert.equal(converted.assignedSalesId, 2);
  assert.equal(String(converted.allocatedDiscountPercent), String(normalDoc.allocatedDiscountPercent), "the dealer's allocated discount is frozen on the converted quotation");
  assert.equal(String(converted.allocatedDiscountPercent), "10");
  assert.equal(String(converted.estimatedEarningPercent), String(normalDoc.estimatedEarningPercent), "and so is the earning percent, exactly as for a normal quotation");
  assert.equal(converted.assignedBy, 1);
  assert.ok(converted.assignedOn);
  const events = await db.collection("quotationauditevents").find({ quotationId: conv.data.quotationId }).toArray();
  assert.deepEqual(events.map((e) => e.action).sort(), ["quotation_assigned", "quotation_created"], "creation and dealer assignment are in the audit trail");
  assert.equal(await db.collection("quotationrooms").countDocuments({ quotationId: conv.data.quotationId }), 1, "rooms come from the house type");
  const after = await leadDoc(dealerLead.id);
  assert.equal(after.status, "quoted");
  assert.equal(after.convertedQuotationId, conv.data.quotationId);
  assert.ok(after.customerId, "a central customer was linked");
  const again = await api(c.owner, "POST", `/api/crm/leads/${dealerLead.id}/convert`, {});
  assert.deepEqual([again.status, again.data.alreadyConverted, again.data.quotationId], [200, true, conv.data.quotationId]);
  pass("Convert builds the quotation like the quotation screen: validated dealer and salesperson, frozen discount allocation and earning, audit trail, rooms; converting again returns the same quotation");

  const raceLead = await mk({ customerName: "Race Convert", phone: "9876500088" });
  const race = await Promise.all([1, 2, 3].map(() => api(c.owner, "POST", `/api/crm/leads/${raceLead.id}/convert`, {})));
  assert.equal(await db.collection("quotations").countDocuments({ leadId: raceLead.id }), 1, `three simultaneous clicks create one quotation (${race.map((r) => r.status)})`);
  assert.ok(race.some((r) => r.status === 200 && r.data.quotationId));
  assert.ok(race.every((r) => r.status === 200 || r.status === 409), "the others are told to wait, not given an error page");
  assert.equal((await leadDoc(raceLead.id)).convertedQuotationId, (await db.collection("quotations").findOne({ leadId: raceLead.id }))._id);
  pass("three simultaneous Convert clicks create exactly one quotation");

  const badDealerLead = await mk({ customerName: "Inactive Dealer", phone: "9876500091", dealerId: 5 });
  await db.collection("adminusers").updateOne({ _id: 5 }, { $set: { isActive: false } });
  const refused = await api(c.owner, "POST", `/api/crm/leads/${badDealerLead.id}/convert`, {});
  assert.ok(refused.status >= 400 && refused.status < 500, `converting with an inactive dealer is refused (${refused.status})`);
  assert.equal((await leadDoc(badDealerLead.id)).convertedQuotationId, null, "a refused conversion leaves the lead unclaimed");
  assert.equal(await db.collection("quotations").countDocuments({ leadId: badDealerLead.id }), 0);
  await db.collection("adminusers").updateOne({ _id: 5 }, { $set: { isActive: true } });
  assert.equal((await api(c.owner, "POST", `/api/crm/leads/${badDealerLead.id}/convert`, {})).status, 200, "and it converts once the dealer is active again");
  pass("an invalid dealer stops the conversion without leaving the lead stuck");

  const lostLead = await mk({ customerName: "Lost Then Convert", phone: "9876500099" });
  assert.equal((await api(c.owner, "PATCH", `/api/crm/leads/${lostLead.id}/status`, { status: "lost", lostReason: "Price" })).status, 200);
  assert.equal((await api(c.owner, "POST", `/api/crm/leads/${lostLead.id}/convert`, {})).status, 200);
  const revived = await leadDoc(lostLead.id);
  assert.deepEqual([revived.status, revived.lostAt, revived.lostReason], ["quoted", null, null], "a revived lead no longer carries its lost date and reason");
  pass("converting a lost lead clears the old lost date and reason");

  // ═══ 2. Activities: permission + the visibility of what they belong to ═══
  const secret = await mk({ customerName: "Secret Corp", phone: "9876500002" });
  assert.equal((await api(c.dealerE, "GET", `/api/crm/activities?leadId=${secret.id}`)).status, 403, "a dealer cannot read lead timelines");
  assert.equal((await api(c.dealerE, "POST", "/api/crm/activities", { leadId: secret.id, type: "note", title: "Injected" })).status, 403);
  assert.equal((await api(c.owner2, "GET", `/api/crm/activities?leadId=${secret.id}`)).status, 404, "another company cannot read it");
  assert.equal((await api(c.owner, "GET", `/api/crm/activities?leadId=${secret.id}`)).status, 200);
  const customerId = (await leadDoc(dealerLead.id)).customerId;
  assert.equal((await api(c.limited, "GET", `/api/crm/activities?leadId=${secret.id}`)).status, 200, "a custom role with leads:read can read lead timelines");
  assert.equal((await api(c.limited, "GET", `/api/crm/activities?customerId=${customerId}`)).status, 403, "but not customer timelines without customers:read");
  assert.equal((await api(c.owner, "GET", `/api/crm/activities?customerId=${customerId}`)).status, 200);
  assert.equal((await api(c.owner, "GET", "/api/crm/activities?customerId=abc")).status, 400);
  assert.equal((await api(c.owner, "GET", "/api/crm/activities")).status, 400);
  assert.equal((await api(c.owner, "POST", "/api/crm/activities", { type: "note", title: "No owner" })).status, 400, "an activity must belong to something");
  assert.equal((await api(c.owner, "POST", "/api/crm/activities", { leadId: "ld_missing", type: "note", title: "Ghost" })).status, 404, "or to something that exists");
  assert.equal((await api(c.owner, "POST", "/api/crm/activities", { leadId: secret.id, type: "call", title: "Called client" })).status, 201);
  assert.equal((await api(c.limited, "POST", "/api/crm/activities", { customerId, type: "note", title: "Not allowed" })).status, 403);
  for (const path of ["/api/crm/leads", "/api/crm/customers", "/api/crm/pipeline"]) {
    assert.equal((await api(c.dealerD, "GET", path)).status, 403, `dealers get 403 from ${path}`);
  }
  pass("timelines need a CRM permission and access to the lead / customer / quotation they belong to; dealers have no CRM access");

  // ═══ 3. Assignees ═══
  const foreign = await api(c.owner, "POST", "/api/crm/leads", { customerName: "Cross Tenant", dealerId: 6 });
  assert.ok(foreign.status === 403 || foreign.status === 404, `a dealer of another company is refused (${foreign.status})`);
  const ghost = await api(c.owner, "POST", "/api/crm/leads", { customerName: "Ghost Sales", assignedSalesId: 999999 });
  assert.equal(ghost.status, 404);
  const wrongRole = await api(c.owner, "POST", "/api/crm/leads", { customerName: "Not a dealer", dealerId: 2 });
  assert.equal(wrongRole.status, 404, "a salesperson cannot be used as a dealer");
  assert.equal((await api(c.owner, "PATCH", `/api/crm/leads/${secret.id}`, { dealerId: 6 })).status >= 400, true, "and on edit");
  assert.equal((await api(c.owner, "PATCH", `/api/crm/leads/${secret.id}`, { dealerId: 4, assignedSalesId: 2 })).status, 200);
  assert.equal(await db.collection("leads").countDocuments({ customerName: { $in: ["Cross Tenant", "Ghost Sales", "Not a dealer"] } }), 0, "nothing was created by the refused requests");
  pass("a lead's dealer and salesperson must be active people of the same company, when created and when edited");

  // ═══ 4. Duplicates ═══
  const formats = [];
  for (const [name, phone] of [["Cust Fmt", "9876500055"], ["Cust Fmt Again", "+91 98765 00055"], ["Cust Fmt Third", "98765-00055"], ["Cust Fmt Fourth", "098765 00055"]]) {
    formats.push((await api(c.owner, "POST", "/api/crm/customers", { name, phone })).status);
  }
  assert.deepEqual(formats, [201, 409, 409, 409], "the same mobile number in any format is one customer");
  const raceBody = { name: "Race Customer", phone: "9876500066" };
  const raced = await Promise.all([1, 2, 3, 4].map(() => api(c.owner, "POST", "/api/crm/customers", raceBody)));
  assert.equal(raced.filter((r) => r.status === 201).length, 1, `simultaneous creates: one wins (${raced.map((r) => r.status)})`);
  assert.ok(raced.every((r) => r.status === 201 || r.status === 409));
  assert.equal(await db.collection("customers").countDocuments({ companyId: 10, phone: "9876500066" }), 1, "and only one record is left");
  const emailA = await api(c.owner, "POST", "/api/crm/customers", { name: "Mail One", email: "Same@Example.com" });
  assert.equal(emailA.status, 201);
  assert.equal((await api(c.owner, "POST", "/api/crm/customers", { name: "Mail Two", email: "same@example.com" })).status, 409, "emails match regardless of case");
  assert.equal((await api(c.owner2, "POST", "/api/crm/customers", { name: "Other Company Same Phone", phone: "9876500055" })).status, 201, "another company may have the same person");
  const other = await api(c.owner, "POST", "/api/crm/customers", { name: "Someone Else", phone: "9876500077" });
  assert.equal((await api(c.owner, "PATCH", `/api/crm/customers/${other.data.id}`, { phone: "+91 98765 00055" })).status, 409, "editing a number onto another customer is refused");
  assert.equal((await api(c.owner, "PATCH", `/api/crm/customers/${other.data.id}`, { name: "Someone Else Renamed" })).status, 200, "other edits are unaffected");

  const first = await mk({ customerName: "Dup Lead One", phone: "9876500101", email: "dup@example.com" });
  assert.deepEqual(first.r.data.possibleDuplicates, { leads: [], customer: null }, "nothing to warn about at first");
  const second = await mk({ customerName: "Dup Lead Two", phone: "+91 98765 00101" });
  assert.deepEqual(second.r.data.possibleDuplicates.leads.map((l) => l.id), [first.id], "a second lead for the same phone is created, with a warning that names the first");
  const third = await mk({ customerName: "Cust Fmt Fan", phone: "98765 00055" });
  assert.equal(third.r.data.possibleDuplicates.customer?.name, "Cust Fmt", "and a warning when the person is already a customer");
  pass("one customer per phone (any format) or email, even for simultaneous requests; leads with a known contact are created with a duplicate warning");

  // ═══ 5. Negotiation and notes ═══
  const neg = await mk({ customerName: "Negotiator", phone: "9876500044", notes: "Gate code 4411. Wants matte black." });
  assert.equal((await api(c.owner, "PATCH", `/api/crm/leads/${neg.id}/status`, { status: "negotiation", notes: "Asked for 5% off" })).status, 200);
  const negDoc = await leadDoc(neg.id);
  assert.deepEqual([negDoc.status, negDoc.notes], ["negotiation", "Gate code 4411. Wants matte black."], "a real status; the lead's notes are untouched");
  assert.equal(await stageOf(neg.id), "negotiation");
  const trail = (await api(c.owner, "GET", `/api/crm/leads/${neg.id}`)).data.activities;
  assert.ok(trail.some((a) => /Asked for 5% off/.test(a.description ?? "")), "the note given with the move is in the timeline");
  assert.equal((await api(c.owner, "PATCH", `/api/crm/leads/${neg.id}/status`, { status: "quoted" })).status, 200);
  assert.equal(await stageOf(neg.id), "quoted", "and the card can leave Negotiation again");
  const legacy = await mk({ customerName: "Legacy Negotiation", phone: "9876500045" });
  await db.collection("leads").updateOne({ _id: legacy.id }, { $set: { status: "quoted", notes: "Negotiation & customer revisions in progress" } });
  assert.equal(await stageOf(legacy.id), "negotiation", "cards moved by the first version still show in Negotiation");
  await api(c.owner, "PATCH", `/api/crm/leads/${legacy.id}/status`, { status: "quoted" });
  assert.deepEqual([await stageOf(legacy.id), (await leadDoc(legacy.id)).notes], ["quoted", null], "and can be moved out; the canned note is dropped");
  pass("Negotiation is a real status: notes are never overwritten, cards move in and out, older cards still display correctly");

  // ═══ 6. Customer profile totals ═══
  await addItem(conv.data.quotationId, 100);
  const profile = await api(c.owner, "GET", `/api/crm/customers/${customerId}`);
  assert.equal(profile.status, 200);
  const profileQuote = profile.data.quotations.find((q) => q.id === conv.data.quotationId);
  assert.ok(profileQuote.grandTotal > 0, `the profile shows the quotation total (${profileQuote.grandTotal})`);
  const card = arr(await api(c.owner, "GET", "/api/crm/pipeline")).flatMap((s) => s.items).find((i) => i.leadId === dealerLead.id);
  assert.equal(profileQuote.grandTotal, card.quotationGrandTotal, "and it equals the total on the pipeline card");
  pass("the customer profile shows each quotation's total, the same figure the pipeline uses");

  // ═══ 7. Lead stages follow their quotation ═══
  const flow = async (name, phone) => {
    const lead = await mk({ customerName: name, phone });
    const cv = await api(c.owner, "POST", `/api/crm/leads/${lead.id}/convert`, { houseTypeId: 101 });
    assert.equal(cv.status, 200, cv.text?.slice(0, 160));
    await addItem(cv.data.quotationId, 100);
    await api(c.owner, "PATCH", `/api/crm/leads/${lead.id}/status`, { status: "contacted" });
    return { lead, qid: cv.data.quotationId };
  };
  const a = await flow("Sync Approve", "9876500201");
  assert.equal((await markSent(c.owner, a.qid)).status, 200);
  assert.equal((await leadDoc(a.lead.id)).status, "quoted", "sending the quotation moves an early lead to Quoted");
  assert.ok((await api(c.owner, "GET", `/api/crm/leads/${a.lead.id}`)).data.activities.some((x) => x.type === "quotation_sent"));
  assert.equal((await api(c.owner, "POST", `/api/quotations/${a.qid}/transition`, { action: "approve" })).status, 200);
  const won = await leadDoc(a.lead.id);
  assert.equal(won.status, "won", "approving the quotation wins the lead");
  assert.ok(won.wonAt);
  assert.equal(await stageOf(a.lead.id), "won");
  const b = await flow("Sync Reject", "9876500202");
  await markSent(c.owner, b.qid);
  assert.equal((await api(c.owner, "POST", `/api/quotations/${b.qid}/transition`, { action: "reject" })).status, 200);
  const lost = await leadDoc(b.lead.id);
  assert.deepEqual([lost.status, lost.lostReason], ["lost", "Quotation rejected"], "rejecting it loses the lead, with the reason");
  assert.ok(lost.lostAt);
  const keep = await flow("Sync Won Stays", "9876500203");
  await markSent(c.owner, keep.qid);
  await api(c.owner, "PATCH", `/api/crm/leads/${keep.lead.id}/status`, { status: "won" });
  await api(c.owner, "POST", `/api/quotations/${keep.qid}/transition`, { action: "reject" });
  assert.equal((await leadDoc(keep.lead.id)).status, "won", "a deal already marked won is not undone by a rejection");
  pass("lead stages follow their quotation: sent → Quoted, approved → Won, rejected → Lost (with reason); a won deal stays won");

  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  if (server) console.error(server.getOutput?.().slice(-3000));
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
