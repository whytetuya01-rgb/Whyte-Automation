import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { connectMongoDB } from "../src/lib/mongodb";
import { Quotation, Customer, CrmActivity } from "../src/models";
import { getNextSequence } from "../src/lib/counter";
import { runUnscoped } from "../src/lib/tenant/context";

const MIGRATION_BATCH = "HISTORICAL_CRM_MIGRATION_2026_V1";
const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

const DUMMY_PATTERNS = [
  /^(\d)\1{9}$/, // 9999999999, 1111111111
  /^123456789\d?$/, // 1234567890
  /^1234560789$/,
  /^123654789\d*$/, // 1236547896, 1236547893652
  /^9898989898$/,
  /^9900990099$/,
  /^9191919190$/,
];

const GENERIC_EMAILS = new Set([
  "abc@gmail.com",
  "admin@gmail.com",
  "test@test.com",
  "j@gmail.com",
  "gate@example.com",
  "savaliyaarjun06@gmail.com",
]);

function isDummyPhone(digits: string): boolean {
  for (const pat of DUMMY_PATTERNS) {
    if (pat.test(digits)) return true;
  }
  return false;
}

function normalizeIndianPhone(rawPhone?: string | null): string | null {
  if (!rawPhone || !rawPhone.trim()) return null;
  const digits = rawPhone.trim().replace(/\D/g, "");

  if (isDummyPhone(digits)) return null;

  if (digits.length === 10 && INDIAN_MOBILE_REGEX.test(digits)) {
    return `+91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith("91") && INDIAN_MOBILE_REGEX.test(digits.slice(2))) {
    return `+91${digits.slice(2)}`;
  }
  if (digits.length === 11 && digits.startsWith("0") && INDIAN_MOBILE_REGEX.test(digits.slice(1))) {
    return `+91${digits.slice(1)}`;
  }
  return null;
}

function normalizeEmail(rawEmail?: string | null): string | null {
  if (!rawEmail || !rawEmail.trim()) return null;
  const trimmed = rawEmail.trim().toLowerCase();
  if (GENERIC_EMAILS.has(trimmed)) return null;
  if (!trimmed.includes("@") || !trimmed.includes(".")) return null;
  return trimmed;
}

function computeCustomerFingerprint(c: {
  name: string;
  phone?: string | null;
  email?: string | null;
  siteAddress?: string | null;
  billingAddress?: string | null;
  gstNumber?: string | null;
  dealerId?: number | null;
  assignedSalesId?: number | null;
}): string {
  const payload = {
    name: c.name.trim(),
    phone: c.phone?.trim() || null,
    email: c.email?.trim().toLowerCase() || null,
    siteAddress: c.siteAddress?.trim() || null,
    billingAddress: c.billingAddress?.trim() || null,
    gstNumber: c.gstNumber?.trim().toUpperCase() || null,
    dealerId: c.dealerId ?? null,
    assignedSalesId: c.assignedSalesId ?? null,
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function executeMigration() {
  console.log("================================================================================");
  console.log("EXECUTING HISTORICAL QUOTATIONS TO CRM CENTRAL CUSTOMERS MIGRATION");
  console.log("Batch ID: " + MIGRATION_BATCH);
  console.log("================================================================================\n");

  await connectMongoDB();

  await runUnscoped("platform-admin", async () => {
    // 1. STEP 1: PRE-EXECUTION SNAPSHOT BACKUP
    console.log("--- STEP 1: Creating Pre-Execution Snapshot Backup ---");
    const backupDir = path.join(process.cwd(), "scripts", "backups");
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const allQuotesBefore = await Quotation.collection.find({}).sort({ createdAt: 1 }).toArray();
    const timestamp = Date.now();
    const backupFilePath = path.join(backupDir, `quotations_pre_migration_${timestamp}.json`);
    const backupJson = JSON.stringify(allQuotesBefore, null, 2);
    const backupHash = crypto.createHash("sha256").update(backupJson).digest("hex");

    fs.writeFileSync(backupFilePath, backupJson, "utf8");
    console.log(`  ✓ Snapshot saved: ${allQuotesBefore.length} quotations exported to:`);
    console.log(`    ${backupFilePath}`);
    console.log(`  ✓ SHA-256 Checksum: ${backupHash}\n`);

    // 2. STEP 2: CLASSIFICATION
    console.log("--- STEP 2: Classifying Historical Quotations ---");

    interface Cluster {
      phone: string;
      quotes: any[];
      canonicalName: string;
      email: string | null;
      siteAddress: string | null;
      gstNumber: string | null;
      dealerId: number | null;
      assignedSalesId: number | null;
      earliestCreatedAt: Date;
    }

    const clusters = new Map<string, Cluster>();
    const testQuarantineQuotes: any[] = [];
    const malformedPhoneQuotes: any[] = [];
    const missingContactQuotes: any[] = [];

    for (const q of allQuotesBefore) {
      if (q.quotationNumber.startsWith("QT-TEST-") || q.clientName === "Release Gate Client") {
        testQuarantineQuotes.push(q);
        continue;
      }

      const normPhone = normalizeIndianPhone(q.clientPhone);
      const normEmail = normalizeEmail(q.clientEmail);

      if (!q.clientPhone?.trim() && !q.clientEmail?.trim()) {
        missingContactQuotes.push(q);
        continue;
      }

      if (!normPhone) {
        malformedPhoneQuotes.push(q);
        continue;
      }

      // Valid Indian Phone -> Cluster
      const cleanName = (q.clientName || "").replace(/\s*\(Revision.*?\)/gi, "").trim() || q.clientName?.trim() || "Customer";

      if (clusters.has(normPhone)) {
        const cl = clusters.get(normPhone)!;
        cl.quotes.push(q);
        if (!cl.email && normEmail) cl.email = normEmail;
        if (!cl.gstNumber && q.clientGstNumber?.trim()) cl.gstNumber = q.clientGstNumber.trim();
        if (!cl.dealerId && q.dealerId) cl.dealerId = q.dealerId;
        if (!cl.assignedSalesId && q.assignedSalesId) cl.assignedSalesId = q.assignedSalesId;
        if (cleanName.length < cl.canonicalName.length && !cleanName.includes("Revision")) {
          cl.canonicalName = cleanName;
        }
        if (new Date(q.createdAt) < cl.earliestCreatedAt) {
          cl.earliestCreatedAt = new Date(q.createdAt);
        }
      } else {
        clusters.set(normPhone, {
          phone: normPhone,
          quotes: [q],
          canonicalName: cleanName,
          email: normEmail,
          siteAddress: q.clientAddress?.trim() || null,
          gstNumber: q.clientGstNumber?.trim() || null,
          dealerId: q.dealerId ?? null,
          assignedSalesId: q.assignedSalesId ?? null,
          earliestCreatedAt: new Date(q.createdAt),
        });
      }
    }

    console.log(`  * Valid Business Quotations: ${clusters.size} clusters (${Array.from(clusters.values()).reduce((a, b) => a + b.quotes.length, 0)} quotations)`);
    console.log(`  * Automated CI/CD Test Quotations Quarantined: ${testQuarantineQuotes.length}`);
    console.log(`  * Malformed / Dummy Phone Proposals in Manual Review: ${malformedPhoneQuotes.length}`);
    console.log(`  * Missing Contact Proposals in Manual Review: ${missingContactQuotes.length}\n`);

    // 3. STEP 3: CREATING CUSTOMERS & LINKING QUOTATIONS
    console.log("--- STEP 3: Creating Central Customer Records & Linking Quotations ---");

    const createdCustomerRows: any[] = [];
    const activitiesToInsert: any[] = [];
    const quotationUpdates: Array<{ qId: string; customerId: number }> = [];

    for (const cluster of clusters.values()) {
      const companyId = cluster.quotes[0].companyId || 1;
      const nextCustomerId = await getNextSequence("customer", Customer);

      const customerDoc = {
        _id: nextCustomerId,
        companyId,
        name: cluster.canonicalName,
        phone: cluster.phone,
        whatsapp: cluster.phone,
        email: cluster.email,
        siteAddress: cluster.siteAddress,
        billingAddress: cluster.siteAddress,
        gstNumber: cluster.gstNumber,
        customerType: "individual",
        assignedSalesId: cluster.assignedSalesId,
        dealerId: cluster.dealerId,
        createdBy: Number(cluster.quotes[0].createdBy) || 1,
        createdAt: cluster.earliestCreatedAt,
        updatedAt: new Date(),
        notes: JSON.stringify({
          migrationBatch: MIGRATION_BATCH,
          fingerprint: computeCustomerFingerprint({
            name: cluster.canonicalName,
            phone: cluster.phone,
            email: cluster.email,
            siteAddress: cluster.siteAddress,
            billingAddress: cluster.siteAddress,
            gstNumber: cluster.gstNumber,
            dealerId: cluster.dealerId,
            assignedSalesId: cluster.assignedSalesId,
          }),
          migratedQuotationIds: cluster.quotes.map((q) => q._id.toString()),
          migratedQuotationNumbers: cluster.quotes.map((q) => q.quotationNumber),
        }),
      };

      createdCustomerRows.push(customerDoc);

      for (const q of cluster.quotes) {
        quotationUpdates.push({ qId: q._id.toString(), customerId: nextCustomerId });

        activitiesToInsert.push({
          _id: `act_mig_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          companyId,
          customerId: nextCustomerId,
          quotationId: q._id.toString(),
          type: "note",
          title: "Historical Quotation Linked",
          description: `Quotation ${q.quotationNumber} linked during Central CRM migration`,
          metadata: {
            quotationNumber: q.quotationNumber,
            migrationBatch: MIGRATION_BATCH,
          },
          performedBy: Number(q.createdBy) || 1,
          performedByName: "CRM Migration Engine",
          performedAt: new Date(q.createdAt),
        });
      }
    }

    // Insert Customer documents
    await Customer.collection.insertMany(createdCustomerRows as any);
    console.log(`  ✓ Inserted ${createdCustomerRows.length} Central Customer records.`);

    // Update Quotations
    let updatedQuotesCount = 0;
    for (const update of quotationUpdates) {
      const res = await Quotation.collection.updateOne(
        { _id: update.qId as any },
        {
          $set: {
            customerId: update.customerId,
            migrationBatch: MIGRATION_BATCH,
          },
        }
      );
      updatedQuotesCount += res.modifiedCount;
    }
    console.log(`  ✓ Linked ${updatedQuotesCount} historical quotations to their respective central customers.`);

    // Insert CRM Activities
    if (activitiesToInsert.length > 0) {
      await CrmActivity.collection.insertMany(activitiesToInsert as any);
      console.log(`  ✓ Created ${activitiesToInsert.length} historical quotation activities in timeline.\n`);
    }

    // 4. STEP 4: POST-MIGRATION VERIFICATION
    console.log("--- STEP 4: Post-Migration Database Count Verification ---");
    const totalCustomersInDb = await Customer.collection.countDocuments({ companyId: 1 });
    const totalQuotesInDb = await Quotation.collection.countDocuments({ companyId: 1 });
    const linkedQuotesInDb = await Quotation.collection.countDocuments({ companyId: 1, customerId: { $ne: null } });
    const unlinkedQuotesInDb = await Quotation.collection.countDocuments({ companyId: 1, customerId: null });

    console.log(`  * Total Central Customers in DB:  ${totalCustomersInDb} (Expected: 24)`);
    console.log(`  * Total Quotations in DB:         ${totalQuotesInDb} (Expected: 67)`);
    console.log(`  * Linked Quotations in DB:        ${linkedQuotesInDb} (Expected: 29)`);
    console.log(`  * Unlinked Quotations in DB:      ${unlinkedQuotesInDb} (Expected: 38)`);

    assert.strictEqual(totalCustomersInDb, 24, "Total customers must be exactly 24");
    assert.strictEqual(totalQuotesInDb, 67, "Total quotations must be preserved at 67");
    assert.strictEqual(linkedQuotesInDb, 29, "Linked quotations must be exactly 29");
    assert.strictEqual(unlinkedQuotesInDb, 38, "Unlinked quotations must be exactly 38");

    // Check pricing / financial preservation for each quotation
    const allQuotesAfter = await Quotation.collection.find({}).sort({ createdAt: 1 }).toArray();
    for (let i = 0; i < allQuotesBefore.length; i++) {
      const before = allQuotesBefore[i];
      const after = allQuotesAfter[i];
      assert.strictEqual(after._id, before._id);
      assert.strictEqual(after.quotationNumber, before.quotationNumber);
      assert.strictEqual(after.status, before.status);
      assert.strictEqual(String(after.discountValue), String(before.discountValue));
      assert.strictEqual(String(after.grandTotal), String(before.grandTotal));
      assert.strictEqual(String(after.subtotal), String(before.subtotal));
    }
    console.log(`  ✓ 100% Quotation financial and structural integrity verified against pre-snapshot.`);

    console.log("\n================================================================================");
    console.log("HISTORICAL CRM MIGRATION SUCCESSFULLY EXECUTED!");
    console.log("================================================================================\n");
  });
}

executeMigration()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration execution failed:", err);
    process.exit(1);
  });

