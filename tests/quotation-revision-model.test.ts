/**
 * An issued quotation revision cannot be rewritten, even by code that bypasses the routes: only its PDF (once) and the facts about
 * being superseded can ever be added; its frozen copy cannot change and nothing can be deleted. Stored PDFs are fully write-once.
 *
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/quotation-revision-model.test.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import "./helpers/localMongoOnly";
import { connectMongoDB } from "../src/lib/mongodb";
import { runWithTenantContext } from "../src/lib/tenant/context";
import { QuotationRevision, QuotationRevisionFile } from "../src/models";
import { assertQuotationEditable, needsApprovalToRevise, revisionRecordId } from "../src/lib/quotationRevisionService";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};
const A = 9850;
const inCompany = <T>(fn: () => Promise<T>) => runWithTenantContext({ companyId: A, userId: 1, role: "admin", actingAsCompany: false }, async () => await fn());
const refused = (promise: Promise<unknown>, label: string) => assert.rejects(promise, /cannot be changed or deleted|cannot be changed/, label);

async function main() {
  await connectMongoDB();
  await Promise.all([QuotationRevision.init(), QuotationRevisionFile.init()]);
  const qid = `QT-MODEL-${Date.now()}`;
  const id = revisionRecordId(qid, 1);
  const cleanup = async () => {
    await QuotationRevision.collection.deleteMany({ companyId: A });
    await QuotationRevisionFile.collection.deleteMany({ companyId: A });
  };
  await cleanup();
  try {
    const snapshot = { quotation: { clientName: "Original" }, rooms: [], totals: { subtotal: 100, discountAmount: 0, netSubtotal: 100, totalGstAmount: 18, grandTotal: 118 } };
    await inCompany(() => QuotationRevision.create([{ _id: id, companyId: A, quotationId: qid, revision: 1, quotationNumber: "QT-1", issuedAt: new Date(), issuedBy: 1, issuedByName: "U", snapshot, pdf: null }]));
    const read = () => QuotationRevision.collection.findOne({ _id: id as never }) as unknown as Promise<Record<string, unknown> & { snapshot: typeof snapshot }>;

    // the frozen copy cannot be changed
    await refused(inCompany(() => QuotationRevision.updateOne({ _id: id }, { $set: { snapshot: { quotation: { clientName: "Edited" } } } })), "snapshot");
    await refused(inCompany(() => QuotationRevision.updateOne({ _id: id }, { $set: { "snapshot.totals.grandTotal": 1 } })), "a nested snapshot field");
    await refused(inCompany(() => QuotationRevision.updateOne({ _id: id }, { $set: { reason: "rewritten", quotationNumber: "QT-2", issuedAt: new Date() } })), "details");
    await refused(inCompany(() => QuotationRevision.updateOne({ _id: id }, { $unset: { snapshot: 1 } })), "$unset");
    await refused(inCompany(() => QuotationRevision.updateOne({ _id: id }, { $inc: { revision: 1 } })), "$inc");
    await refused(inCompany(() => QuotationRevision.updateOne({ _id: id }, { $set: { supersededAt: new Date(), snapshot: { x: 1 } } })), "an allowed field cannot smuggle a forbidden one");
    await refused(inCompany(() => QuotationRevision.updateOne({ _id: id }, {})), "an empty update");
    await refused(inCompany(() => QuotationRevision.findOneAndUpdate({ _id: id }, { $set: { reason: "x" } })), "findOneAndUpdate");
    await refused(inCompany(() => QuotationRevision.updateMany({}, { $set: { reason: "x" } })), "updateMany");
    await refused(inCompany(() => QuotationRevision.replaceOne({ _id: id }, { companyId: A, quotationId: qid, revision: 1, snapshot: {} } as never)), "replaceOne");
    await refused(inCompany(() => QuotationRevision.deleteOne({ _id: id })), "deleteOne");
    await refused(inCompany(() => QuotationRevision.deleteMany({})), "deleteMany");
    await refused(inCompany(() => QuotationRevision.findOneAndDelete({ _id: id })), "findOneAndDelete");
    await inCompany(async () => {
      const doc = await QuotationRevision.findById(id);
      assert.ok(doc);
      doc.reason = "edited through a document";
      await refused(doc.save(), "save of an existing document");
      await refused(doc.deleteOne(), "deleting a document");
    });
    const unchanged = await read();
    assert.deepEqual([unchanged.snapshot, unchanged.reason, unchanged.quotationNumber], [snapshot, null, "QT-1"]);
    pass("a frozen revision cannot be changed or deleted by any model operation (update, nested update, unset, inc, replace, delete, save)");

    // what may be added
    const pdf = { source: "revision_file", fileId: id, sha256: "a".repeat(64), size: 10, attachedAt: new Date() };
    await inCompany(() => QuotationRevision.updateOne({ _id: id, pdf: null }, { $set: { pdf } }));
    assert.equal((await read()).pdf !== null, true, "the PDF can be attached");
    const second = await inCompany(() => QuotationRevision.updateOne({ _id: id, pdf: null }, { $set: { pdf: { ...pdf, sha256: "b".repeat(64) } } }));
    assert.equal(second.modifiedCount, 0, "and only while there is none");
    assert.equal(((await read()).pdf as { sha256: string }).sha256, "a".repeat(64));
    await inCompany(() => QuotationRevision.updateOne({ _id: id, supersededAt: null }, { $set: { supersededAt: new Date(), supersededBy: 2, supersededByRevision: 2, statusWhenSuperseded: "approved", approvedAt: new Date(), approvedBy: 3 } }));
    const done = await read();
    assert.deepEqual([done.supersededByRevision, done.statusWhenSuperseded, done.supersededBy, done.approvedBy], [2, "approved", 2, 3]);
    assert.deepEqual(done.snapshot, snapshot, "the frozen copy is still as issued");
    const again = await inCompany(() => QuotationRevision.updateOne({ _id: id, supersededAt: null }, { $set: { supersededAt: new Date(), supersededBy: 9, supersededByRevision: 9, statusWhenSuperseded: "sent" } }));
    assert.equal(again.modifiedCount, 0, "being superseded is recorded once");
    pass("only the PDF (while there is none) and the superseded facts (once) can be added to a frozen revision");

    // revisions are unique per quotation
    await assert.rejects(inCompany(() => QuotationRevision.create([{ _id: `${id}-dup`, companyId: A, quotationId: qid, revision: 1, quotationNumber: "QT-1", issuedAt: new Date(), snapshot }])), /duplicate key|E11000/);
    pass("a quotation has at most one record per revision number");

    // stored PDFs are fully write-once
    const bytes = Buffer.from("%PDF-1.4\nbody\n%%EOF\n");
    await inCompany(() => QuotationRevisionFile.create([{ _id: id, companyId: A, mime: "application/pdf", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), data: bytes }]));
    await refused(inCompany(() => QuotationRevisionFile.updateOne({ _id: id }, { $set: { data: Buffer.from("tampered") } })), "file update");
    await refused(inCompany(() => QuotationRevisionFile.deleteOne({ _id: id })), "file delete");
    await refused(inCompany(() => QuotationRevisionFile.findOneAndUpdate({ _id: id }, { $set: { size: 1 } })), "file findOneAndUpdate");
    await refused(inCompany(() => QuotationRevisionFile.replaceOne({ _id: id }, { companyId: A } as never)), "file replace");
    await inCompany(async () => {
      const doc = await QuotationRevisionFile.findById(id);
      assert.ok(doc);
      doc.size = 5;
      await refused(doc.save(), "file document save");
    });
    const file = (await QuotationRevisionFile.collection.findOne({ _id: id as never })) as unknown as { data: { buffer: Uint8Array }; sha256: string };
    assert.equal(Buffer.from(file.data.buffer).toString(), bytes.toString(), "the stored bytes are untouched");
    pass("a stored revision PDF cannot be replaced, edited or deleted");

    // tenant isolation
    const other = await runWithTenantContext({ companyId: A + 1, userId: 1, role: "admin", actingAsCompany: false }, async () => await QuotationRevision.countDocuments({}));
    assert.equal(other, 0, "another company sees no revisions");
    pass("revisions are invisible to other companies");

    // pure rules
    assert.doesNotThrow(() => assertQuotationEditable({ status: "draft", revision: 3 }));
    for (const status of ["sent", "approved", "rejected", "delivered"]) assert.throws(() => assertQuotationEditable({ status, revision: 2 }), new RegExp(`revision 2, ${status}\\) and is locked`));
    assert.deepEqual(["draft", "sent", "rejected", "approved", "delivered"].map(needsApprovalToRevise), [false, false, false, true, true]);
    assert.equal(revisionRecordId("QT-1", 3), "qr_QT-1_3");
    pass("only a draft is editable; only approved and delivered quotations need an approver to be revised");
  } finally {
    await cleanup();
  }
  console.log(`\nALL ${count} QUOTATION REVISION MODEL TESTS PASSED!`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
