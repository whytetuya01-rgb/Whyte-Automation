/**
 * Quotation revisions through the real API (production-mode server + throwaway local MongoDB):
 *   issuing freezes a copy (+ PDF) and locks the quotation; a revision keeps the issued version exactly as it was and reopens the
 *   quotation as the next revision under the SAME number; approved / delivered quotations need an approver; the PDF of a version is
 *   write-once; older sent quotations get a rebuilt record; other companies and other dealers see nothing.
 *
 *   node tests/quotation-revisions-api.test.mjs
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;
process.env.SESSION_ACTOR_CACHE_TTL_MS = "0";
const dec = (v) => Decimal128.fromString(v);
const fakePdf = (label) => Buffer.from(`%PDF-1.4\n% ${label}\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`);
const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");

try {
  server = await startIsolatedServer("qrevisions", [
    { _id: 1, email: "ownera@example.com", role: "company_owner", name: "Owner A", companyId: 20 },
    { _id: 2, email: "dealera@example.com", role: "dealer", name: "Dealer A", discountAllocationPercent: 10, companyId: 20 },
    { _id: 3, email: "dealera2@example.com", role: "dealer", name: "Dealer A2", discountAllocationPercent: 10, companyId: 20 },
    { _id: 4, email: "ownerb@example.com", role: "company_owner", name: "Owner B", companyId: 30 },
  ], { production: true });
  const { db, login, api, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertMany([
    { _id: 20, name: "Acme Homes", slug: "acme-homes", status: "active", phone: "+91 90000 11111", address: "Ahmedabad", gstNumber: null, email: "a@acme.example", logoUrl: null, tagline: null, createdAt: now, updatedAt: now },
    { _id: 30, name: "Beta Builders", slug: "beta-builders", status: "active", phone: "+91 90000 22222", address: "Surat", gstNumber: null, email: "b@beta.example", logoUrl: null, tagline: null, createdAt: now, updatedAt: now },
  ]);
  await db.collection("categories").insertOne({ _id: 201, companyId: 20, name: "Tactus", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [], createdAt: now });
  await db.collection("roomtypes").insertOne({ _id: 201, companyId: 20, name: "Living Room", isActive: true, sortOrder: 1 });
  await db.collection("housetypes").insertOne({ _id: 201, companyId: 20, name: "2 BHK", isActive: true, sortOrder: 1 });
  await db.collection("housetyperoomtemplates").insertOne({ _id: 201, companyId: 20, houseTypeId: 201, roomTypeId: 201, defaultCount: 1, sortOrder: 1 });
  await db.collection("products").insertMany([
    { _id: 2001, companyId: 20, name: "Smart Switch", code: "P-2001", type: "switch_board", categoryId: 201, unit: "pcs", isActive: true, sortOrder: 1, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now },
    { _id: 2002, companyId: 20, name: "Switch Frame", code: "P-2002", type: "accessory", categoryId: 201, unit: "pcs", isActive: true, sortOrder: 2, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now },
  ]);
  const variant = (id, productId, code, price, pwt) => ({ _id: id, companyId: 20, productId, variantCode: code, name: code, config: {}, price: dec(price), priceWithoutTax: dec(pwt), taxPercent: dec("18.00"), cost: dec("0.00"), purchaseTaxPercent: dec("18.00"), isActive: true, sortOrder: id, createdAt: now, updatedAt: now });
  await db.collection("productvariants").insertMany([variant(1, 2001, "SW-1", "1180.00", "1000.00"), variant(2, 2002, "FR-1", "300.00", "254.24")]);
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const c = { owner: await login("ownera@example.com", "admin"), dealer: await login("dealera@example.com", "user"), dealer2: await login("dealera2@example.com", "user"), b: await login("ownerb@example.com", "admin") };

  const newQuotation = async (cookie = c.dealer, client = "Client One") => {
    const created = await api(cookie, "POST", "/api/quotations", { clientName: client, houseTypeId: 201 });
    assert.equal(created.status, 201, created.text?.slice(0, 300));
    const id = created.data.id ?? created.data._id;
    const roomId = (await api(cookie, "GET", `/api/quotations/${id}`)).data.rooms[0].id;
    return { id, roomId, number: (await db.collection("quotations").findOne({ _id: id })).quotationNumber };
  };
  const addItem = (cookie, q, productId, variantId, quantity = 1) => api(cookie, "POST", `/api/quotations/${q.id}/items`, { quotationRoomId: q.roomId, productId, productVariantId: variantId, quantity });
  const quotationRow = (id) => db.collection("quotations").findOne({ _id: id });
  const records = (id) => db.collection("quotationrevisions").find({ quotationId: id }).sort({ revision: 1 }).toArray();
  let sends = 0;
  /** Marks a quotation sent together with its PDF (as Download PDF / Print / Share / Send do). */
  const send = async (cookie, q, pdf = fakePdf(`issued ${(sends += 1)}`)) => {
    const form = new FormData();
    form.append("pdf", new Blob([pdf], { type: "application/pdf" }), "q.pdf");
    const res = await fetch(`${baseUrl}/api/quotations/${q.id}/mark-sent`, { method: "POST", headers: { Cookie: cookie }, body: form });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, data: json?.data, text };
  };
  const uploadPdf = async (cookie, q, buffer) => {
    const form = new FormData();
    form.append("pdf", new Blob([buffer], { type: "application/pdf" }), "q.pdf");
    const res = await fetch(`${baseUrl}/api/quotations/${q.id}/revisions/current/pdf`, { method: "POST", headers: { Cookie: cookie }, body: form });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, data: json?.data, text };
  };
  const revisions = (cookie, q) => api(cookie, "GET", `/api/quotations/${q.id}/revisions`);

  // ═══ issuing freezes a copy and locks ═══
  const q1 = await newQuotation();
  assert.equal((await addItem(c.dealer, q1, 2001, 1, 2)).status, 201);
  assert.equal((await addItem(c.dealer, q1, 2002, 2, 1)).status, 201);
  assert.equal((await quotationRow(q1.id)).revision, 1, "a new quotation starts at revision 1");
  assert.equal((await records(q1.id)).length, 0, "nothing is frozen while it is a draft");
  assert.equal((await api(c.dealer, "PATCH", `/api/quotations/${q1.id}`, { notes: "draft note" })).status, 200, "a draft can be edited");

  // a draft is never "sent" without its PDF: not through mark-sent, not through a plain edit
  const bare = await api(c.dealer, "POST", `/api/quotations/${q1.id}/mark-sent`);
  assert.equal(bare.status, 400, bare.text?.slice(0, 200));
  assert.equal(bare.json.error.details.reason, "PDF_REQUIRED");
  assert.match(bare.json.error.message, /together with its PDF/);
  const viaEdit = await api(c.owner, "PATCH", `/api/quotations/${q1.id}`, { status: "sent" });
  assert.equal(viaEdit.status, 409, viaEdit.text?.slice(0, 200));
  assert.equal((await send(c.dealer, q1, Buffer.from("not a pdf at all"))).status, 415, "not a PDF");
  assert.deepEqual([(await quotationRow(q1.id)).status, (await records(q1.id)).length], ["draft", 0], "still a draft, nothing issued");
  pass("a draft cannot become sent without its PDF (mark-sent without one, a non-PDF, or a plain edit are refused and change nothing)");

  const pdf1 = fakePdf("revision one");
  const sent = await send(c.dealer, q1, pdf1);
  assert.equal(sent.status, 200, sent.text?.slice(0, 300));
  assert.deepEqual([sent.data.status, sent.data.revision], ["sent", 1]);
  const [rev1] = await records(q1.id);
  assert.deepEqual([rev1.revision, rev1.quotationNumber, rev1.issuedBy, rev1.issuedByName, rev1.reconstructed, rev1.supersededAt], [1, q1.number, 2, "Dealer A", false, null]);
  assert.deepEqual([rev1.pdf?.source, rev1.pdf?.sha256], ["revision_file", sha(pdf1)], "issued together with the PDF that was sent");
  assert.equal(rev1.snapshot.quotation.clientName, "Client One");
  assert.equal(rev1.snapshot.quotation.notes, "draft note");
  assert.deepEqual(rev1.snapshot.rooms.map((r) => [r.name, r.items.map((i) => [i.productName, i.productCode, i.quantity, i.unitPrice])]), [["Living Room", [["Smart Switch", "P-2001", 2, 1180], ["Switch Frame", "P-2002", 1, 300]]]], "the room, products, quantities and prices the client saw");
  assert.equal(rev1.snapshot.totals.subtotal, 2660, "2 x 1180 + 300");
  assert.ok(rev1.snapshot.totals.grandTotal > 0);
  assert.equal((await send(c.dealer, q1, fakePdf("downloaded again"))).status, 200, "sending twice is harmless (a later PDF never replaces the kept one)");
  assert.equal((await records(q1.id))[0].pdf.sha256, sha(pdf1));
  assert.equal((await records(q1.id)).length, 1, "and does not create a second record");
  pass("sending a quotation freezes revision 1: the details, rooms, products, quantities, prices and totals as the client saw them");

  const before = JSON.stringify(rev1);
  const lockedResponses = [
    await addItem(c.dealer, q1, 2001, 1, 1),
    await api(c.dealer, "PATCH", `/api/quotations/${q1.id}`, { notes: "changed after sending" }),
    await api(c.dealer, "PATCH", `/api/quotations/${q1.id}/items/${(await db.collection("quotationitems").findOne({}))._id}`, { quantity: 9 }),
    await api(c.dealer, "DELETE", `/api/quotations/${q1.id}/items/${(await db.collection("quotationitems").findOne({}))._id}`),
    await api(c.dealer, "POST", `/api/quotations/${q1.id}/rooms`, { roomTypeId: 201 }),
    await api(c.dealer, "PATCH", `/api/quotations/${q1.id}`, { status: "draft" }),
  ];
  for (const response of lockedResponses) {
    assert.equal(response.status, 403, response.text?.slice(0, 200));
    assert.match(response.json.error.message, /issued \(revision 1, sent\) and is locked\. Create a new revision/);
  }
  assert.equal((await quotationRow(q1.id)).notes, "draft note", "nothing changed");
  assert.equal(await db.collection("quotationitems").countDocuments({}), 2);
  assert.equal(JSON.stringify((await records(q1.id))[0]), before);
  pass("once issued the quotation is locked: items, rooms and details cannot be changed, and it cannot be quietly set back to draft");

  // ═══ the PDF of a version ═══
  assert.equal((await uploadPdf(c.dealer, q1, Buffer.from("not a pdf at all"))).status, 415, "not a PDF");
  const again = await uploadPdf(c.dealer, q1, pdf1);
  assert.deepEqual([again.status, again.data.stored], [200, false], "the same PDF again changes nothing");
  const different = await uploadPdf(c.dealer, q1, fakePdf("a different one"));
  assert.equal(different.status, 409, "a different PDF for an issued version is refused");
  assert.match(different.json.error.message, /never replaced/);
  const download = await fetch(`${baseUrl}/api/quotations/${q1.id}/revisions/1/pdf`, { headers: { Cookie: c.dealer } });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-type"), "application/pdf");
  assert.match(download.headers.get("content-disposition"), new RegExp(`${q1.number}-rev1\\.pdf`));
  assert.equal(sha(Buffer.from(await download.arrayBuffer())), sha(pdf1), "byte for byte what was stored");
  assert.equal((await fetch(`${baseUrl}/api/quotations/${q1.id}/revisions/2/pdf`, { headers: { Cookie: c.dealer } })).status, 404, "a revision with no PDF says so");
  const draftOnly = await newQuotation();
  assert.equal((await uploadPdf(c.dealer, draftOnly, pdf1)).status, 409, "a draft has nothing issued to attach a PDF to");
  pass("the PDF of an issued version is stored once, returned byte for byte, never replaced; a non-PDF or a draft is refused");

  // ═══ revising ═══
  const listed = await revisions(c.dealer, q1);
  assert.equal(listed.status, 200);
  assert.deepEqual([listed.data.currentRevision, listed.data.status, listed.data.revisions.length, listed.data.revisions[0].hasPdf, listed.data.revisions[0].current, listed.data.revisions[0].grandTotal > 0, listed.data.canApprove], [1, "sent", 1, true, true, true, false]);
  assert.equal((await api(c.dealer, "POST", `/api/quotations/${q1.id}/revisions`, {})).status, 400, "a reason is required");
  assert.equal((await api(c.dealer, "POST", `/api/quotations/${q1.id}/revisions`, { reason: "x", extra: 1 })).status, 400);
  const revised = await api(c.dealer, "POST", `/api/quotations/${q1.id}/revisions`, { reason: "Client asked for two more switches" });
  assert.equal(revised.status, 201, revised.text?.slice(0, 300));
  assert.deepEqual([revised.data.kind, revised.data.revision], ["revised", 2]);
  const reopened = await quotationRow(q1.id);
  assert.deepEqual([reopened.status, reopened.revision, reopened.quotationNumber, reopened.sentAt, reopened.revisionReason, reopened.dealerId], ["draft", 2, q1.number, null, "Client asked for two more switches", 2], "back to draft as revision 2 with the SAME number and dealer");
  const [r1after] = await records(q1.id);
  assert.deepEqual([r1after.snapshot, r1after.pdf.sha256, r1after.supersededBy, r1after.supersededByRevision, r1after.statusWhenSuperseded], [rev1.snapshot, sha(pdf1), 2, 2, "sent"], "revision 1 is exactly as it was, now marked superseded");
  assert.ok(r1after.supersededAt);
  assert.equal((await api(c.dealer, "POST", `/api/quotations/${q1.id}/revisions`, { reason: "again" })).status, 409, "a draft cannot be revised");
  const events = (await api(c.dealer, "GET", `/api/quotations/${q1.id}/activity`)).data;
  assert.ok(JSON.stringify(events).includes("revision_created"), "the activity history records it");
  pass("revising keeps issued revision 1 exactly as it was (snapshot and PDF), reopens the quotation as draft revision 2 with the same number, and records it");

  // ═══ edit, issue revision 2, both versions stay ═══
  const itemId = (await db.collection("quotationitems").find({}).sort({ _id: 1 }).toArray())[0]._id;
  assert.equal((await api(c.dealer, "PATCH", `/api/quotations/${q1.id}/items/${itemId}`, { quantity: 4 })).status, 200, "editable again");
  const pdf2 = fakePdf("revision two");
  assert.equal((await send(c.dealer, q1, pdf2)).data.revision, 2);
  assert.equal((await uploadPdf(c.dealer, q1, pdf2)).data.revision, 2);
  const [r1, r2] = await records(q1.id);
  assert.equal(r2.reason, "Client asked for two more switches");
  assert.equal(r2.basedOnRevision, 1);
  assert.equal(r2.snapshot.totals.subtotal, 5020, "4 x 1180 + 300");
  assert.equal(r1.snapshot.totals.subtotal, 2660, "revision 1 still shows what it showed");
  assert.equal(JSON.stringify(r1.snapshot), JSON.stringify(rev1.snapshot));
  const d1 = await fetch(`${baseUrl}/api/quotations/${q1.id}/revisions/1/pdf`, { headers: { Cookie: c.dealer } });
  const d2 = await fetch(`${baseUrl}/api/quotations/${q1.id}/revisions/2/pdf`, { headers: { Cookie: c.dealer } });
  assert.deepEqual([sha(Buffer.from(await d1.arrayBuffer())), sha(Buffer.from(await d2.arrayBuffer()))], [sha(pdf1), sha(pdf2)], "each version keeps its own PDF");
  const snap = await api(c.dealer, "GET", `/api/quotations/${q1.id}/revisions/1`);
  assert.equal(snap.data.snapshot.totals.subtotal, 2660);
  assert.equal(snap.data.hasPdf, true);
  const latest = await revisions(c.dealer, q1);
  assert.deepEqual(latest.data.revisions.map((r) => [r.revision, r.current, Boolean(r.superseded), r.hasPdf]), [[2, true, false, true], [1, false, true, true]]);
  pass("issuing revision 2 freezes the new numbers and PDF while revision 1 still shows its own numbers and PDF; both can be opened any time");

  // ═══ approval controls ═══
  const approve = await api(c.owner, "POST", `/api/quotations/${q1.id}/transition`, { action: "approve" });
  assert.equal(approve.status, 200, approve.text?.slice(0, 300));
  const request = await api(c.dealer, "POST", `/api/quotations/${q1.id}/revisions`, { reason: "Colour change" });
  assert.equal(request.status, 202, request.text?.slice(0, 300));
  assert.deepEqual([request.data.kind, request.data.request.status, request.data.request.requestedByName], ["requested", "pending", "Dealer A"], "an approved quotation is not revised by the dealer directly: a request is filed");
  const stillApproved = await quotationRow(q1.id);
  assert.deepEqual([stillApproved.status, stillApproved.revision], ["approved", 2], "and nothing changed yet");
  assert.equal((await api(c.dealer, "POST", `/api/quotations/${q1.id}/revisions`, { reason: "Again" })).status, 409, "one request at a time");
  assert.equal((await api(c.dealer, "POST", `/api/quotations/${q1.id}/revisions/request/decision`, { decision: "approve" })).status, 403, "a dealer cannot decide");
  assert.equal((await api(c.owner, "POST", `/api/quotations/${q1.id}/revisions/request/decision`, { decision: "maybe" })).status, 400);
  assert.equal((await revisions(c.owner, q1)).data.request.status, "pending");
  const rejected = await api(c.owner, "POST", `/api/quotations/${q1.id}/revisions/request/decision`, { decision: "reject", note: "Price is agreed" });
  assert.deepEqual([rejected.status, rejected.data.kind], [200, "rejected"]);
  const afterReject = await quotationRow(q1.id);
  assert.deepEqual([afterReject.status, afterReject.revision, afterReject.revisionRequest.status, afterReject.revisionRequest.decisionNote, afterReject.revisionRequest.decidedByName], ["approved", 2, "rejected", "Price is agreed", "Owner A"], "rejecting leaves the approved quotation exactly as it is");
  assert.equal((await api(c.owner, "POST", `/api/quotations/${q1.id}/revisions/request/decision`, { decision: "approve" })).status, 409, "nothing is waiting any more");

  assert.equal((await api(c.dealer, "POST", `/api/quotations/${q1.id}/revisions`, { reason: "Client really needs a colour change" })).status, 202);
  const approved = await api(c.owner, "POST", `/api/quotations/${q1.id}/revisions/request/decision`, { decision: "approve", note: "OK" });
  assert.deepEqual([approved.status, approved.data.kind, approved.data.revision], [200, "revised", 3]);
  const afterApprove = await quotationRow(q1.id);
  assert.deepEqual([afterApprove.status, afterApprove.revision, afterApprove.approvedAt, afterApprove.revisionReason, afterApprove.quotationNumber], ["draft", 3, null, "Client really needs a colour change", q1.number], "approving the request reopens it as revision 3 and clears the old approval");
  const [, r2done] = await records(q1.id);
  assert.deepEqual([r2done.statusWhenSuperseded, Boolean(r2done.approvedAt), r2done.approvedBy, r2done.supersededBy], ["approved", true, 1, 2], "revision 2 remembers it was approved, by whom, and who superseded it");
  assert.equal(JSON.stringify(r2done.snapshot), JSON.stringify(r2.snapshot), "and is otherwise untouched");
  const trail = JSON.stringify((await api(c.owner, "GET", `/api/quotations/${q1.id}/activity`)).data);
  for (const action of ["revision_requested", "revision_request_decided", "revision_created"]) assert.ok(trail.includes(action), `${action} is in the history`);

  // an approver revises an approved quotation directly
  assert.equal((await send(c.dealer, q1)).data.revision, 3);
  assert.equal((await api(c.owner, "POST", `/api/quotations/${q1.id}/transition`, { action: "approve" })).status, 200);
  const direct = await api(c.owner, "POST", `/api/quotations/${q1.id}/revisions`, { reason: "Owner correction" });
  assert.deepEqual([direct.status, direct.data.kind, direct.data.revision], [201, "revised", 4], "an approver does not need to ask");
  // a rejected quotation is revised by its owner
  const q2 = await newQuotation(c.dealer, "Client Two");
  await addItem(c.dealer, q2, 2001, 1, 1);
  await send(c.dealer, q2);
  assert.equal((await api(c.owner, "POST", `/api/quotations/${q2.id}/transition`, { action: "reject" })).status, 200);
  const fromRejected = await api(c.dealer, "POST", `/api/quotations/${q2.id}/revisions`, { reason: "Lower the price" });
  assert.deepEqual([fromRejected.status, fromRejected.data.kind, fromRejected.data.revision], [201, "revised", 2], "a rejected quotation is revised directly by whoever may edit it");
  assert.equal((await records(q2.id))[0].statusWhenSuperseded, "rejected");
  pass("approved / delivered quotations are revised only by an approver or after one approves a request (rejection leaves it untouched, one request at a time, a dealer cannot decide); sent and rejected ones are revised directly; everything is recorded");

  // ═══ sending by WhatsApp stores that PDF as the version's ═══
  const q3 = await newQuotation(c.dealer, "Client Three");
  await addItem(c.dealer, q3, 2001, 1, 1);
  const deliveryPdf = fakePdf("sent by whatsapp");
  const form = new FormData();
  form.append("channel", "whatsapp");
  form.append("to", "9876543210");
  form.append("pdf", new Blob([deliveryPdf], { type: "application/pdf" }), "q.pdf");
  const shared = await fetch(`${baseUrl}/api/quotations/${q3.id}/deliveries`, { method: "POST", headers: { Cookie: c.dealer }, body: form });
  assert.equal(shared.status, 201, await shared.clone().text());
  const [r3] = await records(q3.id);
  assert.deepEqual([(await quotationRow(q3.id)).status, r3.revision, r3.pdf.source, r3.pdf.sha256], ["sent", 1, "delivery", sha(deliveryPdf)], "sending issues revision 1 and keeps the PDF that was sent (not copied)");
  const fromDelivery = await fetch(`${baseUrl}/api/quotations/${q3.id}/revisions/1/pdf`, { headers: { Cookie: c.dealer } });
  assert.equal(sha(Buffer.from(await fromDelivery.arrayBuffer())), sha(deliveryPdf));
  assert.equal((await uploadPdf(c.dealer, q3, fakePdf("other"))).status, 409, "and it cannot be replaced");
  assert.equal((await uploadPdf(c.dealer, q3, deliveryPdf)).data.stored, false);
  // an older sent quotation (issued before revisions existed) has its record rebuilt, with its last delivery's PDF
  await db.collection("quotationrevisions").deleteMany({ quotationId: q3.id });
  const rebuilt = await revisions(c.dealer, q3);
  assert.deepEqual([rebuilt.data.revisions.length, rebuilt.data.revisions[0].reconstructed, rebuilt.data.revisions[0].hasPdf], [1, true, true], "an older sent quotation gets a rebuilt record, marked as such, with its delivery's PDF");
  pass("sending by WhatsApp or email stores the PDF that was sent as the version's PDF; an older sent quotation (no record) is rebuilt on first look, marked reconstructed, and keeps its delivery PDF");

  // ═══ the delivery history says which version each send carried ═══
  const deliveriesOf = (cookie) => api(cookie, "GET", `/api/quotations/${q3.id}/deliveries`);
  assert.deepEqual((await deliveriesOf(c.dealer)).data.map((d) => d.revision), [1], "the first send carried revision 1");
  await db.collection("quotationdeliveries").updateMany({ quotationId: q3.id }, { $unset: { revision: "" } });
  assert.deepEqual((await deliveriesOf(c.dealer)).data.map((d) => d.revision), [1], "a delivery from before versions were recorded reads as revision 1");
  assert.equal((await api(c.dealer, "POST", `/api/quotations/${q3.id}/revisions`, { reason: "Client asked for a second switch" })).status, 201);
  const q3room = (await api(c.dealer, "GET", `/api/quotations/${q3.id}`)).data.rooms[0].id;
  assert.equal((await addItem(c.dealer, { id: q3.id, roomId: q3room }, 2002, 2, 1)).status, 201);
  const second = new FormData();
  second.append("channel", "whatsapp");
  second.append("to", "9876543210");
  second.append("pdf", new Blob([fakePdf("revision two by whatsapp")], { type: "application/pdf" }), "q.pdf");
  const sharedAgain = await fetch(`${baseUrl}/api/quotations/${q3.id}/deliveries`, { method: "POST", headers: { Cookie: c.dealer }, body: second });
  assert.equal(sharedAgain.status, 201, await sharedAgain.clone().text());
  const history = (await deliveriesOf(c.dealer)).data;
  assert.deepEqual(history.map((d) => d.revision).sort(), [1, 2], "the send after the revision carried revision 2; the earlier one still says 1");
  const adminList = await api(c.owner, "GET", "/api/deliveries?channel=whatsapp");
  assert.equal(adminList.status, 200, adminList.text?.slice(0, 200));
  const mine = adminList.data.data.filter((row) => row.quotation?.id === q3.id);
  assert.deepEqual(mine.map((row) => [row.revision, row.canRetry]).sort(), [[1, false], [2, false]], "the admin log shows the version too; a WhatsApp share has nothing to retry");
  pass("each delivery records which revision it carried (older ones read as revision 1), in the quotation's history and in the admin log");

  // ═══ access ═══
  assert.equal((await revisions(c.dealer2, q1)).status, 403, "another dealer cannot see them");
  assert.equal((await api(c.dealer2, "POST", `/api/quotations/${q2.id}/revisions`, { reason: "mine now" })).status, 403, "or revise them");
  assert.equal((await fetch(`${baseUrl}/api/quotations/${q1.id}/revisions/1/pdf`, { headers: { Cookie: c.dealer2 } })).status, 403);
  assert.equal((await revisions(c.b, q1)).status, 404, "another company finds nothing");
  assert.equal((await api(c.b, "GET", `/api/quotations/${q1.id}/revisions/1`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/quotations/${q1.id}/revisions`)).status, 401);
  assert.equal((await api(c.owner, "GET", `/api/quotations/${q1.id}/revisions/abc`)).status, 400);
  assert.equal((await api(c.owner, "GET", `/api/quotations/${q1.id}/revisions/99`)).status, 404);
  assert.equal((await api(c.dealer2, "POST", `/api/quotations/${q1.id}/revisions/request/decision`, { decision: "approve" })).status, 403);
  pass("another dealer, another company and signed-out visitors cannot see, download or create revisions; a bad or missing revision number is a clear error");

  console.log(`\nALL ${count} QUOTATION REVISION API TESTS PASSED!`);
} catch (error) {
  console.error(error);
  if (server) console.error("---- server output (tail) ----\n" + server.getOutput().slice(-3000));
  exitCode = 1;
} finally {
  await server?.cleanup();
  process.exit(exitCode);
}
