/**
 * CRM security regression tests through the real API (production-mode server + throwaway local MongoDB; nothing here
 * reads .env.local):
 *   A. quotation create / edit cannot link leads or customers that do not exist, belong to another company, belong to
 *      someone the caller may not act for, or are already taken; terminal leads never move backwards; relationship
 *      changes leave a timeline trail; pricing is untouched.
 *   B. the unique customer-phone index and E11000 handling under concurrent requests.
 *   E. customer / lead references (dealer, salesperson, customer, source) are validated against the company.
 *   D. Convert is recoverable and never creates a second quotation.
 * Filter-override attempts (C) need a real query run: see tests/crm-visibility.test.ts.
 *
 *   node tests/crm-security.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;

try {
  const CRM_ADMIN_PERMISSIONS = ["quotations:read_all", "quotations:create", "quotations:edit_all", "customers:read", "customers:manage", "leads:read", "leads:manage"];
  server = await startIsolatedServer("crm-security", [
    { _id: 1, email: "owner@example.com", role: "company_owner", name: "Owner A", companyId: 10 },
    { _id: 2, email: "salesa@example.com", role: "sales_executive", name: "Sales A", companyId: 10 },
    { _id: 4, email: "dealerd@example.com", role: "dealer", name: "Dealer D", discountAllocationPercent: 10, companyId: 10 },
    { _id: 5, email: "dealere@example.com", role: "dealer", name: "Dealer E", discountAllocationPercent: 10, companyId: 10 },
    { _id: 6, email: "dealerx@example.com", role: "dealer", name: "Dealer X (other company)", discountAllocationPercent: 10, companyId: 20 },
    { _id: 7, email: "nocrm@example.com", role: "configurable_admin", name: "No CRM Admin", permissions: ["quotations:read_all", "quotations:create", "quotations:edit_all"], companyId: 10 },
    { _id: 8, email: "owner2@example.com", role: "company_owner", name: "Owner B", companyId: 20 },
    { _id: 9, email: "crmadmin@example.com", role: "configurable_admin", name: "CRM Admin", permissions: CRM_ADMIN_PERMISSIONS, companyId: 10 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
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
    owner2: await login("owner2@example.com", "admin"),
    nocrm: await login("nocrm@example.com", "admin"),
    crm: await login("crmadmin@example.com", "admin"),
    dealerD: await login("dealerd@example.com", "user"),
  };

  const mkLead = async (body, who = c.owner) => {
    const r = await api(who, "POST", "/api/crm/leads", body);
    assert.equal(r.status, 201, `lead ${body.customerName}: ${r.text?.slice(0, 200)}`);
    return r.data.id;
  };
  const mkCustomer = async (body, who = c.owner) => {
    const r = await api(who, "POST", "/api/crm/customers", body);
    assert.equal(r.status, 201, `customer ${body.name}: ${r.text?.slice(0, 200)}`);
    return r.data.id;
  };
  const lead = (id) => db.collection("leads").findOne({ _id: id });
  const quoteCount = (clientName) => db.collection("quotations").countDocuments({ clientName });
  const quoteOf = (id) => db.collection("quotations").findOne({ _id: id });
  const newQuote = (who, body) => api(who, "POST", "/api/quotations", body);
  const idOf = (r) => r.data?.id ?? r.data?._id;
  const activities = async (query) => db.collection("crmactivities").find(query).toArray();

  // ═══ A. quotation create: leadId / customerId ═══
  const leadFree = await mkLead({ customerName: "Free Lead", phone: "9000000001" });
  const leadOther = await mkLead({ customerName: "Other Company Lead", phone: "9000000002" }, c.owner2);
  const customerA = await mkCustomer({ name: "Customer A", phone: "9100000001" });
  const customerOther = await mkCustomer({ name: "Other Company Customer", phone: "9100000002" }, c.owner2);

  const refuse = async (label, who, body, statuses) => {
    const res = await newQuote(who, { clientName: label, ...body });
    assert.ok(statuses.includes(res.status), `${label}: expected ${statuses}, got ${res.status} ${res.text?.slice(0, 160)}`);
    assert.equal(await quoteCount(label), 0, `${label}: nothing was created`);
  };
  await refuse("Ghost lead", c.owner, { leadId: "ld_doesnotexist" }, [404]);
  await refuse("Ghost customer", c.owner, { customerId: 987654 }, [404]);
  await refuse("Foreign lead", c.owner, { leadId: leadOther }, [404]);
  await refuse("Foreign customer", c.owner, { customerId: customerOther }, [404]);
  await refuse("Dealer links lead", c.dealerD, { leadId: leadFree }, [403]);
  await refuse("Dealer links customer", c.dealerD, { customerId: customerA }, [403]);
  await refuse("No-CRM admin links lead", c.nocrm, { leadId: leadFree }, [403]);
  await refuse("No-CRM admin links customer", c.nocrm, { customerId: customerA }, [403]);
  assert.equal((await lead(leadFree)).convertedQuotationId, null, "no refused request touched the lead");
  pass("quotation create refuses nonexistent ids, another company's lead / customer, and callers without the CRM permission; nothing is created and the lead is untouched");

  const linked = await newQuote(c.crm, { clientName: "Linked quote", leadId: leadFree, customerId: customerA, houseTypeId: 101 });
  assert.equal(linked.status, 201, linked.text?.slice(0, 200));
  const linkedId = idOf(linked);
  const linkedDoc = await quoteOf(linkedId);
  assert.deepEqual([linkedDoc.leadId, linkedDoc.customerId], [leadFree, customerA]);
  const afterLink = await lead(leadFree);
  assert.deepEqual([afterLink.convertedQuotationId, afterLink.status], [linkedId, "quoted"], "the lead points at the quotation and an early lead moves to Quoted");
  assert.ok((await activities({ leadId: leadFree, quotationId: linkedId, title: "Quotation Linked" })).length === 1, "the lead's timeline records the link");
  assert.ok((await activities({ customerId: customerA, quotationId: linkedId, title: "Quotation Linked" })).length >= 1, "and so does the customer's");
  assert.equal(await db.collection("quotationauditevents").countDocuments({ quotationId: linkedId, action: "quotation_created" }), 1, "the quotation's own audit trail is unchanged");
  pass("a permitted user can link an existing lead and customer: the link, the stage move and both timelines are recorded");

  // Pricing and dealer snapshot are untouched by linking
  const dealerPlain = await newQuote(c.dealerD, { clientName: "Dealer plain quote" });
  assert.equal(dealerPlain.status, 201);
  const plainDoc = await quoteOf(idOf(dealerPlain));
  assert.deepEqual([plainDoc.dealerId, String(plainDoc.allocatedDiscountPercent)], [4, "10"], "dealer quotations still freeze the dealer's allocation");
  const adminLinkedDealer = await newQuote(c.owner, { clientName: "Owner quote for dealer", dealerId: 4, leadId: await mkLead({ customerName: "Lead for dealer quote", phone: "9000000003" }) });
  assert.equal(adminLinkedDealer.status, 201, adminLinkedDealer.text?.slice(0, 200));
  const adminDealerDoc = await quoteOf(idOf(adminLinkedDealer));
  assert.deepEqual([adminDealerDoc.dealerId, String(adminDealerDoc.allocatedDiscountPercent), String(adminDealerDoc.estimatedEarningPercent)], [4, "10", String(plainDoc.estimatedEarningPercent)], "linking a lead does not change the discount / earning snapshot");
  pass("creating with a link leaves quotation pricing, dealer allocation and earning exactly as without one");

  // Already-taken, terminal and simultaneous
  await refuse("Second quote for taken lead", c.owner, { leadId: leadFree }, [409]);
  assert.equal((await lead(leadFree)).convertedQuotationId, linkedId, "an existing conversion link is never overwritten");
  const convertedByConvert = await mkLead({ customerName: "Converted first", phone: "9000000004" });
  assert.equal((await api(c.owner, "POST", `/api/crm/leads/${convertedByConvert}/convert`, {})).status, 200);
  await refuse("Quote for converted lead", c.owner, { leadId: convertedByConvert }, [409]);

  for (const status of ["won", "lost", "negotiation"]) {
    const id = await mkLead({ customerName: `Terminal ${status}`, phone: `90000001${status === "won" ? 1 : status === "lost" ? 2 : 3}`, status });
    const res = await newQuote(c.owner, { clientName: `Quote for ${status} lead`, leadId: id });
    assert.equal(res.status, 201, `${status}: ${res.text?.slice(0, 160)}`);
    const doc = await lead(id);
    assert.deepEqual([doc.status, doc.convertedQuotationId], [status, idOf(res)], `a ${status} lead keeps its stage when a quotation is linked`);
  }
  const raceLead = await mkLead({ customerName: "Race lead", phone: "9000000005" });
  const raced = await Promise.all([1, 2, 3, 4].map((i) => newQuote(c.owner, { clientName: `Race quote ${i}`, leadId: raceLead })));
  const winners = raced.filter((r) => r.status === 201);
  assert.equal(winners.length, 1, `simultaneous creates: one wins (${raced.map((r) => r.status)})`);
  assert.ok(raced.every((r) => r.status === 201 || r.status === 409));
  assert.equal((await lead(raceLead)).convertedQuotationId, idOf(winners[0]), "and the lead points at the winner");
  assert.equal(await db.collection("quotations").countDocuments({ leadId: raceLead }), 1, "exactly one quotation carries the lead");
  pass("a lead that already has a quotation is never taken over; Won / Lost / Negotiation leads never move; four simultaneous creates produce one link");

  // ═══ A. quotation edit ═══
  const editTarget = idOf(await newQuote(c.crm, { clientName: "Edit target" }));
  const otherLead = await mkLead({ customerName: "Edit other lead", phone: "9000000006" });
  const customerB = await mkCustomer({ name: "Customer B", phone: "9100000003" });
  const patch = (who, id, body) => api(who, "PATCH", `/api/quotations/${id}`, body);

  // customer
  assert.equal((await patch(c.crm, editTarget, { customerId: 987654 })).status, 404);
  assert.equal((await patch(c.crm, editTarget, { customerId: customerOther })).status, 404, "another company's customer");
  assert.equal((await patch(c.nocrm, editTarget, { customerId: customerA })).status, 403, "no CRM permission");
  assert.equal((await quoteOf(editTarget)).customerId ?? null, null, "refused edits changed nothing");
  assert.equal((await patch(c.crm, editTarget, { customerId: customerA })).status, 200);
  assert.equal((await quoteOf(editTarget)).customerId, customerA);
  assert.equal((await patch(c.crm, editTarget, { customerId: customerA })).status, 200, "the same value again is fine");
  assert.equal((await patch(c.crm, editTarget, { customerId: null, clientName: "Edit target renamed" })).status, 200, "null means no change, not unlink");
  assert.equal((await quoteOf(editTarget)).customerId, customerA);
  assert.equal((await patch(c.crm, editTarget, { customerId: customerB })).status, 200, "a permitted user may move it to another customer");
  assert.equal((await quoteOf(editTarget)).customerId, customerB);
  assert.equal((await activities({ customerId: customerA, quotationId: editTarget, title: "Quotation Unlinked" })).length, 1, "the previous customer's timeline records the move away");
  assert.ok((await activities({ customerId: customerB, quotationId: editTarget, title: "Quotation Linked" })).length >= 1, "the new customer's timeline records the link");

  // a dealer's own quotation: the form re-sends what it has, but cannot re-link
  const dealerQuote = idOf(await newQuote(c.dealerD, { clientName: "Dealer edit quote" }));
  assert.equal((await patch(c.dealerD, dealerQuote, { customerId: customerA })).status, 403, "a dealer cannot link a customer");
  assert.equal((await patch(c.dealerD, dealerQuote, { leadId: otherLead })).status, 403, "or a lead");
  assert.equal((await patch(c.dealerD, dealerQuote, { customerId: null, leadId: null, clientName: "Dealer edit renamed" })).status, 200, "an unchanged form (null links) still saves");
  assert.equal((await quoteOf(dealerQuote)).clientName, "Dealer edit renamed");
  const dealerLinked = idOf(await newQuote(c.owner, { clientName: "Owner linked for dealer", dealerId: 4, customerId: customerA }));
  assert.equal((await patch(c.dealerD, dealerLinked, { customerId: customerA, clientName: "Dealer saves linked" })).status, 200, "a dealer saving a linked quotation with its own customer id is fine");
  assert.equal((await patch(c.dealerD, dealerLinked, { customerId: customerB })).status, 403, "but cannot move it to another customer");
  assert.equal((await quoteOf(dealerLinked)).customerId, customerA);

  // lead
  assert.equal((await patch(c.crm, editTarget, { leadId: "ld_doesnotexist" })).status, 404);
  assert.equal((await patch(c.crm, editTarget, { leadId: leadOther })).status, 404, "another company's lead");
  assert.equal((await patch(c.nocrm, editTarget, { leadId: otherLead })).status, 403);
  assert.equal((await patch(c.crm, editTarget, { leadId: leadFree })).status, 409, "a lead that already has a quotation");
  assert.equal((await lead(leadFree)).convertedQuotationId, linkedId, "and its link is intact");
  assert.equal((await patch(c.crm, editTarget, { leadId: otherLead })).status, 200, "a free lead can be linked");
  assert.deepEqual([(await quoteOf(editTarget)).leadId, (await lead(otherLead)).convertedQuotationId, (await lead(otherLead)).status], [otherLead, editTarget, "quoted"]);
  assert.equal((await activities({ leadId: otherLead, quotationId: editTarget, title: "Quotation Linked" })).length, 1);
  const secondLead = await mkLead({ customerName: "Second edit lead", phone: "9000000007" });
  assert.equal((await patch(c.crm, editTarget, { leadId: secondLead })).status, 409, "a quotation linked to a lead can never be moved to another lead");
  assert.deepEqual([(await quoteOf(editTarget)).leadId, (await lead(secondLead)).convertedQuotationId], [otherLead, null], "neither side changed");
  assert.equal((await patch(c.crm, editTarget, { leadId: otherLead, clientName: "Edit target again" })).status, 200, "re-sending the current lead is fine");
  assert.equal((await patch(c.crm, editTarget, { leadId: null })).status, 200);
  assert.equal((await quoteOf(editTarget)).leadId, otherLead, "null never unlinks");
  pass("quotation edits cannot reassign a lead or customer: bad ids, other companies, missing permission, taken leads and lead moves are refused; legitimate re-links leave Linked / Unlinked entries; unchanged forms still save");

  // ═══ B. customer unique index and E11000 ═══
  let indexes = [];
  for (let i = 0; i < 40 && !indexes.some((x) => x.name === "uniq_active_company_phone"); i += 1) {
    indexes = await db.collection("customers").indexes().catch(() => []);
    if (!indexes.some((x) => x.name === "uniq_active_company_phone")) await new Promise((r) => setTimeout(r, 250));
  }
  const phoneIndex = indexes.find((x) => x.name === "uniq_active_company_phone");
  assert.ok(phoneIndex, "the unique phone index exists");
  assert.deepEqual(phoneIndex.key, { companyId: 1, phone: 1 }, "company-scoped");
  assert.equal(phoneIndex.unique, true);
  assert.deepEqual(phoneIndex.partialFilterExpression, { phone: { $type: "string" }, isDeleted: false }, "only active customers with a phone");
  assert.equal(indexes.filter((x) => JSON.stringify(x.key) === JSON.stringify({ companyId: 1, phone: 1 })).length, 1, "and there is no second index on the same keys");

  const raceBody = { name: "Race Customer", phone: "9876500166" };
  const results = await Promise.all(Array.from({ length: 8 }, () => api(c.owner, "POST", "/api/crm/customers", raceBody)));
  assert.equal(results.filter((r) => r.status === 201).length, 1, `eight simultaneous creates: one wins (${results.map((r) => r.status)})`);
  assert.ok(results.every((r) => r.status === 201 || r.status === 409), "every other answer is a controlled 409");
  assert.ok(!results.some((r) => /E11000|duplicate key|mongo|collection|index/i.test(r.text ?? "")), "no database error text reaches the client");
  assert.equal(await db.collection("customers").countDocuments({ companyId: 10, phone: "9876500166" }), 1);

  const archivedId = await mkCustomer({ name: "To Archive", phone: "9876500177" });
  assert.equal((await api(c.owner, "DELETE", `/api/crm/customers/${archivedId}`)).status, 200);
  assert.equal((await api(c.owner, "POST", "/api/crm/customers", { name: "Reuses Archived Phone", phone: "9876500177" })).status, 201, "an archived (soft-deleted) customer does not block its phone");
  assert.equal(await db.collection("customers").countDocuments({ companyId: 10, phone: "9876500177" }), 2);

  await db.collection("customers").insertOne({ _id: 90001, companyId: 10, name: "Legacy no isDeleted", phone: "9876500188", customerType: "individual", createdBy: 1, createdAt: now, updatedAt: now });
  const legacy = await api(c.owner, "POST", "/api/crm/customers", { name: "Same As Legacy", phone: "9876500188" });
  assert.equal(legacy.status, 409, "a legacy customer without isDeleted counts as active");
  assert.ok(!/E11000|duplicate key/i.test(legacy.text ?? ""));
  const dupInsert = async (doc) => db.collection("customers").insertOne({ ...doc, customerType: "individual", createdBy: 1, createdAt: now, updatedAt: now }).then(() => null, (error) => error);
  await db.collection("customers").insertOne({ _id: 90010, companyId: 10, name: "Raw A", phone: "9333333333", isDeleted: false, customerType: "individual", createdBy: 1, createdAt: now, updatedAt: now });
  assert.equal((await dupInsert({ _id: 90011, companyId: 10, name: "Raw B", phone: "9333333333", isDeleted: false }))?.code, 11000, "the index itself refuses a second active customer with the phone");
  assert.equal(await dupInsert({ _id: 90012, companyId: 20, name: "Raw other company", phone: "9333333333", isDeleted: false }), null, "another company may have it");
  assert.equal(await dupInsert({ _id: 90013, companyId: 10, name: "Raw deleted", phone: "9333333333", isDeleted: true }), null, "a soft-deleted record is outside the index");
  assert.equal(await dupInsert({ _id: 90014, companyId: 10, name: "Raw null phone", phone: null, isDeleted: false }), null, "null phones are not indexed");
  assert.equal(await dupInsert({ _id: 90015, companyId: 10, name: "Raw null phone 2", phone: null, isDeleted: false }), null, "so any number of them is fine");
  assert.equal(await dupInsert({ _id: 90016, companyId: 10, name: "Raw missing isDeleted", phone: "9333333333" }), null, "documents without isDeleted are outside the index; the application check covers them");

  // The same person arriving through several quotations at once
  const sameCustomer = await Promise.all([1, 2, 3, 4].map((i) => newQuote(c.owner, { clientName: `Parallel customer ${i}`, clientPhone: "9444444444" })));
  assert.ok(sameCustomer.every((r) => r.status === 201), `all quotations are created (${sameCustomer.map((r) => r.status)})`);
  const customerIds = new Set((await db.collection("quotations").find({ clientName: /^Parallel customer/ }).toArray()).map((q) => q.customerId));
  assert.equal(customerIds.size, 1, "and all point at one customer");
  assert.ok([...customerIds][0], "that customer exists");
  assert.equal(await db.collection("customers").countDocuments({ companyId: 10, phone: "9444444444", isDeleted: { $ne: true } }), 1);
  pass("the phone index is company-scoped, partial and unique; eight simultaneous creates leave one customer with controlled 409s and no database text; archived and legacy records behave as the delete policy says; parallel quotations share one customer");

  // ═══ E. reference validation ═══
  const bad = async (label, who, method, path, body, statuses) => {
    const res = await api(who, method, path, body);
    assert.ok(statuses.includes(res.status), `${label}: expected ${statuses}, got ${res.status} ${res.text?.slice(0, 160)}`);
  };
  await bad("customer: dealer of another company", c.owner, "POST", "/api/crm/customers", { name: "Bad Dealer", dealerId: 6 }, [403, 404]);
  await bad("customer: salesperson that does not exist", c.owner, "POST", "/api/crm/customers", { name: "Bad Sales", assignedSalesId: 999999 }, [404]);
  await bad("customer: a salesperson used as dealer", c.owner, "POST", "/api/crm/customers", { name: "Wrong Role", dealerId: 2 }, [404]);
  await db.collection("adminusers").updateOne({ _id: 5 }, { $set: { isActive: false } });
  await bad("customer: inactive dealer", c.owner, "POST", "/api/crm/customers", { name: "Inactive Dealer", dealerId: 5 }, [400, 422]);
  await db.collection("adminusers").updateOne({ _id: 5 }, { $set: { isActive: true } });
  assert.equal(await db.collection("customers").countDocuments({ name: { $in: ["Bad Dealer", "Bad Sales", "Wrong Role", "Inactive Dealer"] } }), 0, "nothing was created");
  const assigned = await mkCustomer({ name: "Assigned Customer", phone: "9100000050", dealerId: 4, assignedSalesId: 2 });
  await bad("customer edit: foreign dealer", c.owner, "PATCH", `/api/crm/customers/${assigned}`, { dealerId: 6 }, [403, 404]);
  await bad("customer edit: missing salesperson", c.owner, "PATCH", `/api/crm/customers/${assigned}`, { assignedSalesId: 999999 }, [404]);
  assert.equal((await db.collection("customers").findOne({ _id: assigned })).dealerId, 4, "refused edits changed nothing");
  await db.collection("adminusers").updateOne({ _id: 4 }, { $set: { isActive: false } });
  await bad("customer edit: an unchanged, now-inactive dealer does not block other edits", c.owner, "PATCH", `/api/crm/customers/${assigned}`, { name: "Assigned Renamed", dealerId: 4 }, [200]);
  await db.collection("adminusers").updateOne({ _id: 4 }, { $set: { isActive: true } });

  await api(c.owner2, "GET", "/api/crm/sources");
  const sourcesA = (await api(c.owner, "GET", "/api/crm/sources")).data;
  const sourcesB = (await api(c.owner2, "GET", "/api/crm/sources")).data;
  assert.ok(sourcesA.length > 0 && sourcesB.length > 0);
  await bad("lead: customer that does not exist", c.owner, "POST", "/api/crm/leads", { customerName: "L1", customerId: 987654 }, [404]);
  await bad("lead: another company's customer", c.owner, "POST", "/api/crm/leads", { customerName: "L2", customerId: customerOther }, [404]);
  await bad("lead: source that does not exist", c.owner, "POST", "/api/crm/leads", { customerName: "L3", sourceId: "src_missing" }, [404]);
  await bad("lead: another company's source", c.owner, "POST", "/api/crm/leads", { customerName: "L4", sourceId: sourcesB[0].id }, [404]);
  const inactiveSource = sourcesA[sourcesA.length - 1];
  await db.collection("leadsources").updateOne({ _id: inactiveSource.id }, { $set: { isActive: false } });
  await bad("lead: inactive source", c.owner, "POST", "/api/crm/leads", { customerName: "L5", sourceId: inactiveSource.id }, [404]);
  assert.equal(await db.collection("leads").countDocuments({ customerName: { $in: ["L1", "L2", "L3", "L4", "L5"] } }), 0, "no lead was created by a refused request");
  const withSource = await api(c.owner, "POST", "/api/crm/leads", { customerName: "L6", sourceId: sourcesA[0].id, sourceName: "Typed by the client", customerId: customerA });
  assert.equal(withSource.status, 201, withSource.text?.slice(0, 200));
  const l6 = await lead(withSource.data.id);
  assert.deepEqual([l6.sourceName, l6.customerId], [sourcesA[0].name, customerA], "the source's own name is stored, not the client's text");
  await bad("lead edit: foreign source", c.owner, "PATCH", `/api/crm/leads/${withSource.data.id}`, { sourceId: sourcesB[0].id }, [404]);
  assert.equal((await lead(withSource.data.id)).sourceId, sourcesA[0].id, "unchanged");
  pass("customers and leads are created and edited only with active dealers / salespeople / sources and visible customers of the same company; refused requests create and change nothing");

  // ═══ D. Convert recovery ═══
  const crashLead = await mkLead({ customerName: "Crash Lead", phone: "9555555501", dealerId: 4 });
  const first = await api(c.owner, "POST", `/api/crm/leads/${crashLead}/convert`, { houseTypeId: 101 });
  assert.equal(first.status, 200, first.text?.slice(0, 200));
  assert.equal(first.data.alreadyConverted, undefined);
  const crashQuote = first.data.quotationId;
  // Simulate a crash after the quotation was saved but before the lead and timeline were finished.
  await db.collection("crmactivities").deleteMany({ leadId: crashLead, title: "Converted to Quotation" });
  await db.collection("leads").updateOne({ _id: crashLead }, { $set: { status: "new", customerId: null } });
  await db.collection("quotations").updateOne({ _id: crashQuote }, { $set: { customerId: null } });
  const recovered = await api(c.owner, "POST", `/api/crm/leads/${crashLead}/convert`, {});
  assert.equal(recovered.status, 200);
  assert.deepEqual([recovered.data.alreadyConverted, recovered.data.quotationId], [true, crashQuote]);
  const healed = await lead(crashLead);
  assert.deepEqual([healed.status, healed.convertedQuotationId], ["quoted", crashQuote], "the lead's stage is finished");
  assert.ok(healed.customerId, "the customer is linked again");
  assert.equal((await quoteOf(crashQuote)).customerId, healed.customerId, "and so is the quotation");
  assert.equal((await activities({ leadId: crashLead, title: "Converted to Quotation" })).length, 1, "the timeline entry exists once");
  for (let i = 0; i < 2; i += 1) assert.equal((await api(c.owner, "POST", `/api/crm/leads/${crashLead}/convert`, {})).data.alreadyConverted, true);
  assert.equal((await activities({ leadId: crashLead, title: "Converted to Quotation" })).length, 1, "repeating changes nothing");
  assert.equal(await db.collection("quotations").countDocuments({ leadId: crashLead }), 1);

  for (const [label, updatedAt] of [["fresh", new Date()], ["hours old", new Date(Date.now() - 3 * 3600_000)]]) {
    const id = await mkLead({ customerName: `Dangling ${label}`, phone: label === "fresh" ? "9555555502" : "9555555503" });
    const ghost = `q_ghost_${label.replace(" ", "_")}`;
    await db.collection("leads").updateOne({ _id: id }, { $set: { convertedQuotationId: ghost, updatedAt } });
    const resumed = await api(c.owner, "POST", `/api/crm/leads/${id}/convert`, {});
    assert.equal(resumed.status, 200, `${label}: ${resumed.text?.slice(0, 200)}`);
    assert.equal(resumed.data.quotationId, ghost, `${label}: the conversion resumes with the id already on the lead`);
    assert.equal(await db.collection("quotations").countDocuments({ leadId: id }), 1);
    assert.equal((await lead(id)).status, "quoted");
  }
  const racingGhost = await mkLead({ customerName: "Dangling race", phone: "9555555504" });
  await db.collection("leads").updateOne({ _id: racingGhost }, { $set: { convertedQuotationId: "q_ghost_race", updatedAt: new Date(Date.now() - 3600_000) } });
  const resumes = await Promise.all([1, 2, 3, 4].map(() => api(c.owner, "POST", `/api/crm/leads/${racingGhost}/convert`, {})));
  assert.equal(await db.collection("quotations").countDocuments({ leadId: racingGhost }), 1, `parallel resumes create one quotation (${resumes.map((r) => r.status)})`);
  assert.ok(resumes.every((r) => r.status === 200 || r.status === 409), "and none of them fails with an error page");
  assert.ok(resumes.some((r) => r.status === 200 && r.data.quotationId === "q_ghost_race"));

  const oldConverted = await mkLead({ customerName: "Old converted lost", phone: "9555555505" });
  const oldQuote = (await api(c.owner, "POST", `/api/crm/leads/${oldConverted}/convert`, {})).data.quotationId;
  await api(c.owner, "PATCH", `/api/crm/leads/${oldConverted}/status`, { status: "lost", lostReason: "Price" });
  const again = await api(c.owner, "POST", `/api/crm/leads/${oldConverted}/convert`, {});
  assert.deepEqual([again.data.alreadyConverted, again.data.quotationId], [true, oldQuote]);
  const stillLost = await lead(oldConverted);
  assert.deepEqual([stillLost.status, stillLost.lostReason], ["lost", "Price"], "converting again never revives a lead that was converted and then lost");
  const oldWon = await mkLead({ customerName: "Old converted won", phone: "9555555506" });
  await api(c.owner, "POST", `/api/crm/leads/${oldWon}/convert`, {});
  await api(c.owner, "PATCH", `/api/crm/leads/${oldWon}/status`, { status: "won" });
  await api(c.owner, "POST", `/api/crm/leads/${oldWon}/convert`, {});
  assert.equal((await lead(oldWon)).status, "won");
  pass("Convert recovers: a crash after the quotation was saved is finished by a retry; a never-saved quotation is created with the id already on the lead (fresh or hours old, no timeout); parallel retries make one quotation; converted leads are never revived");

  console.log(`\n${count} passed`);
} catch (error) {
  console.error("FAIL", error?.stack ?? error);
  if (server) console.error(server.getOutput?.().slice(-3000));
  exitCode = 1;
} finally {
  if (server) await server.cleanup();
  process.exit(exitCode);
}
