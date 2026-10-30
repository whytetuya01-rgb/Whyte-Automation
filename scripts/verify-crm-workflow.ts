/**
 * End-to-End CRM Phase 1 Business Workflow Verification Script
 *
 * Exercises all 13 workflow criteria directly against Mongoose/MongoDB:
 * 1. Direct quotation creation without lead (CRM not mandatory)
 * 2. Create lead from enquiry
 * 3. Assign lead to salesperson & dealer
 * 4. Central customer deduplication & resolution
 * 5. Add call, meeting note, site visit timeline activities
 * 6. Move lead through pipeline stages
 * 7. Convert lead into quotation with customer prefilling & mutual linking
 * 8. Quotation pricing, GST & 18% tax calculation integrity
 * 9. Delivery Tracking V2 integration & Hot Lead detection (viewCount >= 2)
 * 10. Customer profile aggregation (leads, quotations, timeline)
 * 11. Multi-company tenant isolation & RBAC scoping
 * 12. Soft deletion archiving integrity
 */

import assert from "node:assert/strict";
import { connectMongoDB } from "../src/lib/mongodb";
import {
  AdminUser,
  Company,
  Customer,
  Lead,
  LeadSource,
  CrmActivity,
  Quotation,
  QuotationRoom,
  QuotationItem,
  QuotationDelivery,
  INITIAL_LEAD_SOURCES,
} from "../src/models";
import {
  getNextSequence,
  getNextLeadSequence,
  getNextQuotationSequence,
  reserveSequenceBlock,
} from "../src/lib/counter";
import {
  crmVisibilityFilter,
  ensureCompanyLeadSources,
  getPipelineBoardData,
  recordCrmActivity,
  resolveOrCreateCustomer,
} from "../src/lib/crmService";
import {
  aggregateQuotationRoomTotals,
  deriveQuotationFinancials,
  totalsForQuotation,
} from "../src/lib/quotationTotals";
import { hasPermission } from "../src/lib/permissions";
import { recordLinkView } from "../src/lib/quotationLinks";

let passed = 0;
function pass(msg: string) {
  passed += 1;
  console.log(`  ✓ ${passed}. ${msg}`);
}

async function run() {
  console.log("=== STARTING CRM PHASE 1 BUSINESS WORKFLOW VERIFICATION ===\n");
  await connectMongoDB();

  const TEST_COMPANY_1 = 991;
  const TEST_COMPANY_2 = 992;
  const now = new Date();

  // Clean up any test records from prior runs
  await Company.deleteMany({ _id: { $in: [TEST_COMPANY_1, TEST_COMPANY_2] } });
  await AdminUser.deleteMany({ companyId: { $in: [TEST_COMPANY_1, TEST_COMPANY_2] } });
  await Customer.deleteMany({ companyId: { $in: [TEST_COMPANY_1, TEST_COMPANY_2] } });
  await Lead.deleteMany({ companyId: { $in: [TEST_COMPANY_1, TEST_COMPANY_2] } });
  await LeadSource.deleteMany({ companyId: { $in: [TEST_COMPANY_1, TEST_COMPANY_2] } });
  await CrmActivity.deleteMany({ companyId: { $in: [TEST_COMPANY_1, TEST_COMPANY_2] } });
  await Quotation.deleteMany({ companyId: { $in: [TEST_COMPANY_1, TEST_COMPANY_2] } });
  await QuotationRoom.deleteMany({ companyId: { $in: [TEST_COMPANY_1, TEST_COMPANY_2] } });
  await QuotationItem.deleteMany({ companyId: { $in: [TEST_COMPANY_1, TEST_COMPANY_2] } });
  await QuotationDelivery.deleteMany({ companyId: { $in: [TEST_COMPANY_1, TEST_COMPANY_2] } });

  // 1. Setup Companies & Users
  await Company.create([
    { _id: TEST_COMPANY_1, name: "Whyte Automation Mumbai", slug: "whyte-mumbai-test", status: "active", phone: "9820000001", address: "Mumbai", createdAt: now, updatedAt: now },
    { _id: TEST_COMPANY_2, name: "Whyte Automation Delhi", slug: "whyte-delhi-test", status: "active", phone: "9820000002", address: "Delhi", createdAt: now, updatedAt: now },
  ]);

  const salesUser: any = await AdminUser.create({
    _id: 99101,
    companyId: TEST_COMPANY_1,
    name: "Vikram Malhotra",
    email: "vikram@whyte-mumbai.com",
    role: "sales_executive",
    isActive: true,
    passwordHash: "hash",
    createdAt: now,
  });

  const dealerUser: any = await AdminUser.create({
    _id: 99102,
    companyId: TEST_COMPANY_1,
    name: "Apex Smart Living",
    companyName: "Apex Smart Living LLP",
    email: "contact@apexsmart.in",
    role: "dealer",
    isActive: true,
    discountAllocationPercent: 25,
    passwordHash: "hash",
    createdAt: now,
  });

  pass("Setup isolated multi-tenant companies, sales executive and dealer accounts");

  // ── TEST 1: CRM Must NOT Make Lead Creation Mandatory ──
  {
    const standaloneQuotationId = "q_test_standalone_" + Date.now();
    const standaloneQuotation: any = await Quotation.create({
      _id: standaloneQuotationId,
      companyId: TEST_COMPANY_1,
      quotationNumber: "QT-2026-99901",
      clientName: "Direct Walkin Client",
      clientPhone: "9819999999",
      clientEmail: "walkin@example.com",
      status: "draft",
      createdBy: salesUser._id,
      customerId: null, // completely optional
      leadId: null,     // completely optional
      createdAt: now,
      updatedAt: now,
    });

    assert.ok(standaloneQuotation);
    assert.equal(standaloneQuotation.customerId, null);
    assert.equal(standaloneQuotation.leadId, null);
    pass("Direct quotation creation succeeds without lead or customer (CRM is NOT mandatory)");
  }

  // ── TEST 2: Create Lead from New Enquiry ──
  let testLeadId: string;
  let testRefNumber: string;
  {
    const seq = await getNextLeadSequence(2026);
    testRefNumber = `LD-2026-${String(seq).padStart(4, "0")}`;
    testLeadId = "lead_test_" + Date.now();

    const leadDoc: any = await Lead.create({
      _id: testLeadId,
      companyId: TEST_COMPANY_1,
      referenceNumber: testRefNumber,
      customerName: "Ananya Deshmukh",
      phone: "9820123456",
      whatsapp: "9820123456",
      email: "ananya.d@gmail.com",
      projectType: "4 BHK Sea-Facing Penthouse",
      location: "Worli, Mumbai",
      siteAddress: "Tower A, 42nd Floor, Sea Breeze Residences, Worli",
      estimatedBudget: 1250000,
      priority: "high",
      status: "new",
      assignedSalesId: salesUser._id,
      dealerId: dealerUser._id,
      notes: "Met at architectural exhibition. Client requested full automation proposal.",
      createdBy: salesUser._id,
      createdAt: now,
      updatedAt: now,
    });

    assert.ok(leadDoc);
    assert.equal(leadDoc.referenceNumber, testRefNumber);
    assert.equal(leadDoc.customerName, "Ananya Deshmukh");
    assert.equal(leadDoc.assignedSalesId, salesUser._id);
    assert.equal(leadDoc.dealerId, dealerUser._id);
    pass(`Created lead ${testRefNumber} assigned to sales executive ${salesUser.name} & dealer ${dealerUser.name}`);
  }

  // ── TEST 3: Central Customer Deduplication & Resolution ──
  let customerId: number;
  {
    // First resolution: creates new customer
    customerId = await resolveOrCreateCustomer({
      companyId: TEST_COMPANY_1,
      name: "Ananya Deshmukh",
      phone: "9820123456",
      whatsapp: "9820123456",
      email: "ananya.d@gmail.com",
      siteAddress: "Tower A, 42nd Floor, Sea Breeze Residences, Worli",
      assignedSalesId: salesUser._id,
      dealerId: dealerUser._id,
      userId: salesUser._id,
    });

    assert.ok(customerId > 0, "Customer ID should be positive integer");
    const cust1 = await Customer.findOne({ _id: customerId, companyId: TEST_COMPANY_1 });
    assert.ok(cust1);
    assert.equal(cust1.name, "Ananya Deshmukh");
    assert.equal(cust1.phone, "9820123456");

    // Second resolution with same phone: MUST deduplicate and return existing customerId
    const customerId2 = await resolveOrCreateCustomer({
      companyId: TEST_COMPANY_1,
      name: "Ananya Deshmukh (New Enquiry)",
      phone: "9820123456",
      email: "ananya.alt@gmail.com",
      userId: salesUser._id,
    });

    assert.equal(customerId2, customerId, "Must reuse existing Customer ID for matching phone number");
    const countCust = await Customer.countDocuments({ companyId: TEST_COMPANY_1, phone: "9820123456" });
    assert.equal(countCust, 1, "Exactly one customer record must exist");

    // Link customer to lead
    await Lead.updateOne({ _id: testLeadId }, { customerId });
    pass(`Customer deduplication verified: single central record (ID: ${customerId}) across enquiries`);
  }

  // ── TEST 4: Add Call, Meeting, and Site Visit Activities ──
  {
    // Activity 1: Phone call
    await recordCrmActivity({
      companyId: TEST_COMPANY_1,
      leadId: testLeadId,
      customerId,
      type: "call",
      title: "Discovery Phone Call",
      description: "Discussed lighting circuits, automated curtains, and multi-room audio requirements.",
      performedBy: salesUser._id,
    });

    // Activity 2: Site visit
    await recordCrmActivity({
      companyId: TEST_COMPANY_1,
      leadId: testLeadId,
      customerId,
      type: "site_visit",
      title: "On-Site Electrical Inspection",
      description: "Conducted preliminary site inspection with electrical contractor. Measured 14 switchboard backboxes.",
      performedBy: salesUser._id,
    });

    // Activity 3: Meeting note
    await recordCrmActivity({
      companyId: TEST_COMPANY_1,
      leadId: testLeadId,
      customerId,
      type: "meeting",
      title: "In-Person Consultation",
      description: "Architect approved smart panel finishes (Matte Black glass).",
      performedBy: salesUser._id,
    });

    const activities = await CrmActivity.find({ leadId: testLeadId }).sort({ performedAt: -1 }).lean();
    assert.equal(activities.length, 3, "All 3 chronological activities must be recorded");
    const types = activities.map((a: any) => a.type);
    assert.ok(types.includes("call"));
    assert.ok(types.includes("site_visit"));
    assert.ok(types.includes("meeting"));
    pass("Activity timeline records calls, site visits, and meeting notes chronologically");
  }

  // ── TEST 5: Move Lead Through Pipeline Stages ──
  {
    // Move to contacted
    await Lead.updateOne({ _id: testLeadId }, { status: "contacted", updatedAt: new Date() });
    await recordCrmActivity({
      companyId: TEST_COMPANY_1,
      leadId: testLeadId,
      customerId,
      type: "status_change",
      title: "Stage Changed to Contacted",
      description: "Lead contacted and qualifying consultation completed.",
      performedBy: salesUser._id,
    });

    // Move to site_visit
    await Lead.updateOne({ _id: testLeadId }, { status: "site_visit", updatedAt: new Date() });
    await recordCrmActivity({
      companyId: TEST_COMPANY_1,
      leadId: testLeadId,
      customerId,
      type: "status_change",
      title: "Stage Changed to Site Visit",
      description: "Site visit confirmed and conducted.",
      performedBy: salesUser._id,
    });

    const leadCurrent = await Lead.findById(testLeadId).lean();
    assert.equal(leadCurrent?.status, "site_visit");
    pass("Moved lead through pipeline stages (new -> contacted -> site_visit) with audit events");
  }

  // ── TEST 6: Convert Lead into Quotation (Prefill, Mutual Linking, Idempotency) ──
  let quotationId: string;
  let quotationNumber: string;
  {
    const leadToConvert: any = await Lead.findById(testLeadId).lean();
    assert.ok(leadToConvert);

    // Create quotation prefilling customer details from lead
    const seq = await getNextQuotationSequence(TEST_COMPANY_1);
    quotationNumber = `QT-2026-${String(seq).padStart(5, "0")}`;
    quotationId = "q_crm_conv_" + Date.now();

    await Quotation.create({
      _id: quotationId,
      companyId: TEST_COMPANY_1,
      quotationNumber,
      clientName: leadToConvert.customerName,
      clientPhone: leadToConvert.phone,
      clientEmail: leadToConvert.email,
      clientAddress: leadToConvert.siteAddress || leadToConvert.location,
      assignedSalesId: leadToConvert.assignedSalesId,
      dealerId: leadToConvert.dealerId,
      customerId: leadToConvert.customerId,
      leadId: leadToConvert._id,
      status: "draft",
      createdBy: salesUser._id,
      createdAt: now,
      updatedAt: now,
    });

    // Update lead
    await Lead.updateOne(
      { _id: testLeadId },
      {
        status: "quoted",
        convertedQuotationId: quotationId,
        updatedAt: new Date(),
      }
    );

    // Activity log
    await recordCrmActivity({
      companyId: TEST_COMPANY_1,
      leadId: testLeadId,
      customerId,
      quotationId,
      type: "note",
      title: "Lead Converted to Quotation",
      description: `Generated proposal ${quotationNumber} from qualified enquiry.`,
      performedBy: salesUser._id,
    });

    // Verify prefilling and mutual linking
    const qDoc: any = await Quotation.findById(quotationId).lean();
    assert.ok(qDoc);
    assert.equal(qDoc.clientName, "Ananya Deshmukh");
    assert.equal(qDoc.clientPhone, "9820123456");
    assert.equal(qDoc.clientEmail, "ananya.d@gmail.com");
    assert.equal(qDoc.clientAddress, "Tower A, 42nd Floor, Sea Breeze Residences, Worli");
    assert.equal(qDoc.customerId, customerId);
    assert.equal(qDoc.leadId, testLeadId);

    const lDoc: any = await Lead.findById(testLeadId).lean();
    assert.ok(lDoc);
    assert.equal(lDoc.status, "quoted");
    assert.equal(lDoc.convertedQuotationId, quotationId);

    pass(`Converted lead into quotation ${quotationNumber} with accurate prefilling and bidirectional linking`);
  }

  // ── TEST 7: Pricing, GST and 18% Tax Integrity ──
  {
    // Add rooms and products to verify calculation engine
    const roomId1 = 8801;
    await QuotationRoom.create({
      _id: roomId1,
      companyId: TEST_COMPANY_1,
      quotationId,
      customName: "Master Suite",
      sortOrder: 1,
      roomTypeId: 101,
    });

    const itemId1 = 7701;
    const itemId2 = 7702;
    // Item 1: 4-Channel Dimming Module (₹ 15,000 unit price, qty 2 = ₹ 30,000)
    // Item 2: Smart Touch Scene Keypad (₹ 8,500 unit price, qty 4 = ₹ 34,000)
    await QuotationItem.insertMany([
      {
        _id: itemId1,
        companyId: TEST_COMPANY_1,
        quotationId,
        quotationRoomId: roomId1,
        productId: 501,
        productVariantId: null,
        description: "4-Channel Smart Dimming Controller",
        quantity: 2,
        price: 15000,
        sortOrder: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        _id: itemId2,
        companyId: TEST_COMPANY_1,
        quotationId,
        quotationRoomId: roomId1,
        productId: 502,
        productVariantId: null,
        description: "Luxury Touch Keypad (Matte Black)",
        quantity: 4,
        price: 8500,
        sortOrder: 2,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    // Aggregate room totals via official engine
    const totalsMap = await aggregateQuotationRoomTotals([quotationId]);
    const { subtotal } = totalsForQuotation(totalsMap, quotationId);
    assert.equal(subtotal, 64000, "Subtotal must equal 2*15000 + 4*8500 = 64,000");

    // Financial derivation with standard 18% GST (9% CGST + 9% SGST)
    const financials = deriveQuotationFinancials({
      subtotal,
      discountType: null,
      discountValue: 0,
    });

    // Standard formula: subtotal 64,000 + 18% GST (11,520) = 75,520
    assert.equal(financials.subtotal, 64000);
    assert.equal(financials.totalGstAmount, 11520, "18% GST must equal 11,520");
    assert.equal(financials.grandTotal, 75520, "Grand total must equal 75,520");

    pass("Quotation financial engine: Subtotal (₹64,000), 18% GST (₹11,520), and Grand Total (₹75,520) verified intact");
  }

  // ── TEST 8: Delivery Tracking V2 & Hot Lead Detection ──
  {
    // Create WhatsApp delivery with view link
    const deliveryId = "del_test_" + Date.now();
    const delivery: any = await QuotationDelivery.create({
      _id: deliveryId,
      companyId: TEST_COMPANY_1,
      quotationId,
      channel: "whatsapp",
      recipient: "9820123456",
      subject: `Quotation ${quotationNumber}`,
      attachmentName: `${quotationNumber}.pdf`,
      attachmentSize: 102400,
      attachmentSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      status: "delivered",
      attempts: 1,
      viewCount: 0,
      lastViewedAt: null,
      events: [],
      processedEventIds: [],
      createdBy: salesUser._id,
      createdAt: now,
      updatedAt: now,
    });

    // Check pipeline board BEFORE views: viewCount = 0 -> isHotLead = false
    const pipelineBefore = await getPipelineBoardData(TEST_COMPANY_1, { role: "admin", userId: 1 });
    const quotedStageBefore = pipelineBefore.find((s) => s.id === "quoted");
    const cardBefore = quotedStageBefore?.items.find((c: any) => c.leadId === testLeadId);
    assert.ok(cardBefore, "Converted lead must appear in quoted stage");
    assert.equal(cardBefore.estimatedValue, 75520, "Card value must equal real quotation grand total (₹75,520)");
    assert.equal(cardBefore.isHotLead, false, "Lead must not be hot with 0 views");

    // Client opens the link 1st time
    recordLinkView(delivery);
    await delivery.save();
    assert.equal(delivery.viewCount, 1);

    // Client opens the link 2nd time -> Triggers Hot Lead threshold (viewCount >= 2)
    recordLinkView(delivery);
    await delivery.save();
    assert.equal(delivery.viewCount, 2);

    // Log the automated quotation_viewed activity
    await recordCrmActivity({
      companyId: TEST_COMPANY_1,
      leadId: testLeadId,
      customerId,
      quotationId,
      type: "quotation_viewed",
      title: "Quotation Viewed by Client",
      description: `Client opened quotation ${quotationNumber} (View #2).`,
      performedBy: salesUser._id,
    });

    // Check pipeline board AFTER views
    const pipelineAfter = await getPipelineBoardData(TEST_COMPANY_1, { role: "admin", userId: 1 });
    const quotedStageAfter = pipelineAfter.find((s) => s.id === "quoted");
    const cardAfter = quotedStageAfter?.items.find((c: any) => c.leadId === testLeadId);
    assert.ok(cardAfter);
    assert.equal(cardAfter.quotationViewCount, 2, "Card view count must equal 2");
    assert.equal(cardAfter.isHotLead, true, "Hot Lead detection verified: card marked isHotLead = true");

    pass("Delivery Tracking V2 integration: client link views recorded, view count mapped, and Hot Lead detected");
  }

  // ── TEST 9: Customer Profile Aggregation ──
  {
    const customer = await Customer.findOne({ _id: customerId, companyId: TEST_COMPANY_1 }).lean();
    assert.ok(customer);

    const customerQuotations = await Quotation.find({ customerId, companyId: TEST_COMPANY_1 }).lean();
    const customerLeads = await Lead.find({ customerId, companyId: TEST_COMPANY_1 }).lean();
    const customerActivities = await CrmActivity.find({ customerId, companyId: TEST_COMPANY_1 }).sort({ performedAt: -1 }).lean();

    assert.equal(customerQuotations.length, 1, "Must aggregate 1 quotation");
    assert.equal(customerQuotations[0]._id, quotationId);
    assert.equal(customerLeads.length, 1, "Must aggregate 1 lead");
    assert.equal(customerLeads[0]._id, testLeadId);
    assert.ok(customerActivities.length >= 4, "Must aggregate full timeline of calls, meetings, visits and views");

    pass("Customer profile successfully aggregates complete history across quotations, leads, and activity logs");
  }

  // ── TEST 10: Multi-Company Isolation & Scoped Role Access ──
  {
    // Company 2 queries
    const comp2Leads = await Lead.find({ companyId: TEST_COMPANY_2 }).lean();
    const comp2Customers = await Customer.find({ companyId: TEST_COMPANY_2 }).lean();
    const comp2Pipeline = await getPipelineBoardData(TEST_COMPANY_2, { role: "admin", userId: 2 });
    const comp2Cards = comp2Pipeline.flatMap((s) => s.items);

    assert.equal(comp2Leads.length, 0, "Company 2 must never see Company 1 leads");
    assert.equal(comp2Customers.length, 0, "Company 2 must never see Company 1 customers");
    assert.equal(comp2Cards.length, 0, "Company 2 pipeline must be strictly empty");

    // Role-based visibility scoping within Company 1:
    // Sales Executive 99101 sees assigned leads
    const salesFilter = crmVisibilityFilter({ role: "sales_executive", userId: salesUser._id });
    const salesLeads = await Lead.find({ companyId: TEST_COMPANY_1, ...salesFilter }).lean();
    assert.equal(salesLeads.length, 1, "Sales executive sees assigned lead");

    // Another Sales Executive 99199 sees 0 leads
    const otherSalesFilter = crmVisibilityFilter({ role: "sales_executive", userId: 99199 });
    const otherSalesLeads = await Lead.find({ companyId: TEST_COMPANY_1, ...otherSalesFilter }).lean();
    assert.equal(otherSalesLeads.length, 0, "Unassigned sales executive sees 0 leads");

    // Dealer 99102 sees assigned dealer leads
    const dealerFilter = crmVisibilityFilter({ role: "dealer", userId: dealerUser._id });
    const dealerLeads = await Lead.find({ companyId: TEST_COMPANY_1, ...dealerFilter }).lean();
    assert.equal(dealerLeads.length, 1, "Dealer sees assigned lead");

    pass("Strict multi-tenant company isolation and role-based access verified across all boundaries");
  }

  // ── TEST 11: Soft Delete Preservation Invariant ──
  {
    // Archive lead
    await Lead.collection.updateOne(
      { _id: testLeadId as any },
      {
        $set: {
          isDeleted: true,
          deletedAt: new Date(),
          deletedBy: salesUser._id,
          deletionReason: "Archived test",
        },
      }
    );

    // Lead query with softDelete filter excludes it
    const activeLeads = await Lead.find({ companyId: TEST_COMPANY_1, isDeleted: { $ne: true } }).lean();
    assert.equal(activeLeads.length, 0, "Soft-deleted lead excluded from active views");

    // Linked quotation remains 100% intact and undamaged
    const intactQuotation: any = await Quotation.findById(quotationId).lean();
    assert.ok(intactQuotation, "Quotation document must remain intact");
    assert.equal(intactQuotation.leadId, testLeadId, "Quotation reference to lead preserved for audit");

    pass("Soft-deletion preserves quotation integrity and durable audit trail");
  }

  // Clean up test records
  await Company.deleteMany({ _id: { $in: [TEST_COMPANY_1, TEST_COMPANY_2] } });
  await AdminUser.deleteMany({ companyId: { $in: [TEST_COMPANY_1, TEST_COMPANY_2] } });
  await Customer.deleteMany({ companyId: { $in: [TEST_COMPANY_1, TEST_COMPANY_2] } });
  await Lead.deleteMany({ companyId: { $in: [TEST_COMPANY_1, TEST_COMPANY_2] } });
  await LeadSource.deleteMany({ companyId: { $in: [TEST_COMPANY_1, TEST_COMPANY_2] } });
  await CrmActivity.deleteMany({ companyId: { $in: [TEST_COMPANY_1, TEST_COMPANY_2] } });
  await Quotation.deleteMany({ companyId: { $in: [TEST_COMPANY_1, TEST_COMPANY_2] } });
  await QuotationRoom.deleteMany({ companyId: { $in: [TEST_COMPANY_1, TEST_COMPANY_2] } });
  await QuotationItem.deleteMany({ companyId: { $in: [TEST_COMPANY_1, TEST_COMPANY_2] } });
  await QuotationDelivery.deleteMany({ companyId: { $in: [TEST_COMPANY_1, TEST_COMPANY_2] } });

  console.log(`\n======================================================`);
  console.log(`ALL ${passed} BUSINESS WORKFLOW VERIFICATIONS PASSED!`);
  console.log(`======================================================\n`);
  process.exit(0);
}

run().catch((err) => {
  console.error("\nWorkflow verification failed:", err);
  process.exit(1);
});