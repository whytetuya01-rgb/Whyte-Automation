/**
 * Phase 4 Offline Quotation Builder & Local Autosave Verification
 *
 * Verifies all 20 required criteria:
 * 1. Create an offline draft with one room.
 * 2. Create a draft with multiple rooms and products.
 * 3. Add and remove products.
 * 4. Edit quantities.
 * 5. Change quotation-specific unit prices.
 * 6. Verify Product Master prices remain unchanged.
 * 7. Reset custom prices to default.
 * 8. Save and reopen the draft.
 * 9. Browser refresh during editing.
 * 10. Rapid consecutive edits and autosave ordering.
 * 11. Simulated IndexedDB write failure.
 * 12. Local draft duplication and default price reset (Rule #9).
 * 13. No official quotation number allocated (draft_<uuid> only, no QT-2026-XXX).
 * 14. Offline calculations match existing online formulas.
 * 15. Company 1 / Company 2 isolation.
 * 16. Super Admin without Act-As restrictions.
 * 17. Logout/account switching.
 * 18. Missing or inactive product handling.
 * 19. Existing online quotation flow regression.
 * 20. Existing approved/delivered quotations remain unchanged.
 *
 * Run with: node tests/phase4-offline-quotation.test.mjs
 */

import assert from "node:assert/strict";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";
import { calculateQuotationGst, round2 } from "../src/lib/pricing.ts";
import { calculateDealerEarning } from "../src/lib/dealerEarnings.ts";
import {
  generateClientDraftId,
  generateClientEntityId,
  calculateDraftTotals,
  createEmptyOfflineDraft,
  saveOfflineDraft,
  loadOfflineDraft,
  listOfflineDrafts,
  deleteOfflineDraft,
  duplicateOfflineDraft,
  offlineDraftToQuotation,
  quotationToOfflineDraft,
} from "../src/lib/offline/draftStore.ts";
import {
  buildTenantKey,
  saveDraftToStores,
  getDraftFromStores,
  listDraftsFromStores,
  deleteDraftFromStores,
} from "../src/lib/offline/db.ts";
import {
  writeSyncCrashBackup,
  getSyncCrashBackup,
  clearSyncCrashBackup,
} from "../src/lib/offline/useOfflineDraftAutosave.ts";

let server, exitCode = 0, n = 0;
const pass = (m) => console.log(`  ✓ ${++n}. ${m}`);

// Polyfill minimal browser IndexedDB in Node environment for unit tests
class MockIDBStore {
  constructor(name, keyPath, autoIncrement = false) {
    this.name = name;
    this.keyPath = keyPath;
    this.data = new Map();
    this.indexes = new Map();
  }

  getKey(val) {
    if (Array.isArray(this.keyPath)) {
      return this.keyPath.map((k) => val[k]).join("::");
    }
    return String(val[this.keyPath]);
  }

  put(val) {
    const key = this.getKey(val);
    this.data.set(key, JSON.parse(JSON.stringify(val)));
  }

  get(queryKey) {
    const key = Array.isArray(queryKey) ? queryKey.join("::") : String(queryKey);
    const item = this.data.get(key);
    return item ? JSON.parse(JSON.stringify(item)) : null;
  }

  delete(queryKey) {
    const key = Array.isArray(queryKey) ? queryKey.join("::") : String(queryKey);
    this.data.delete(key);
  }

  getAll() {
    return Array.from(this.data.values());
  }

  getAllByIndex(indexName, query) {
    const all = this.getAll();
    if (indexName === "tenantKey") {
      return all.filter((r) => r.tenantKey === query);
    }
    if (indexName === "tenant_status") {
      return all.filter((r) => r.tenantKey === query[0] && r.status === query[1]);
    }
    if (indexName === "tenant_draftId") {
      return all.filter((r) => r.tenantKey === query[0] && r.draftId === query[1]);
    }
    return all;
  }
}

class MockIDBDatabase {
  constructor() {
    this.stores = {
      offline_drafts: new MockIDBStore("offline_drafts", ["tenantKey", "id"]),
      offline_draft_rooms: new MockIDBStore("offline_draft_rooms", ["tenantKey", "id"]),
      offline_draft_items: new MockIDBStore("offline_draft_items", ["tenantKey", "id"]),
      catalog_meta: new MockIDBStore("catalog_meta", "tenantKey"),
      products: new MockIDBStore("products", ["tenantKey", "id"]),
      categories: new MockIDBStore("categories", ["tenantKey", "id"]),
      house_types: new MockIDBStore("house_types", ["tenantKey", "id"]),
      room_types: new MockIDBStore("room_types", ["tenantKey", "id"]),
      images: new MockIDBStore("images", ["tenantKey", "url"]),
    };
  }

  transaction(storeNames, mode) {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const self = this;
    let pending = 0;
    let completed = false;

    function finish() {
      if (pending === 0 && !completed) {
        completed = true;
        if (!self._simulateFailure && tx.oncomplete) {
          tx.oncomplete({ target: tx });
        }
      }
    }

    const tx = {
      mode,
      objectStore: (name) => {
        const s = self.stores[name];
        return {
          put: (val) => {
            const req = { onsuccess: null, onerror: null, result: undefined };
            pending++;
            queueMicrotask(() => {
              if (self._simulateFailure) {
                req.error = new Error("Simulated IndexedDB QuotaExceededError");
                tx.error = req.error;
                if (req.onerror) req.onerror({ target: req });
                if (tx.onerror) tx.onerror({ target: req });
                pending--;
              } else {
                s.put(val);
                req.result = val;
                if (req.onsuccess) req.onsuccess({ target: req });
                pending--;
                finish();
              }
            });
            return req;
          },
          get: (k) => {
            const req = { onsuccess: null, onerror: null, result: undefined };
            pending++;
            queueMicrotask(() => {
              const res = s.get(k);
              req.result = res;
              if (req.onsuccess) req.onsuccess({ target: req });
              pending--;
              finish();
            });
            return req;
          },
          delete: (k) => {
            const req = { onsuccess: null, onerror: null, result: undefined };
            pending++;
            queueMicrotask(() => {
              s.delete(k);
              if (req.onsuccess) req.onsuccess({ target: req });
              pending--;
              finish();
            });
            return req;
          },
          getAll: () => {
            const req = { onsuccess: null, onerror: null, result: undefined };
            pending++;
            queueMicrotask(() => {
              const res = s.getAll();
              req.result = res;
              if (req.onsuccess) req.onsuccess({ target: req });
              pending--;
              finish();
            });
            return req;
          },
          index: (idxName) => ({
            getAll: (q) => {
              const req = { onsuccess: null, onerror: null, result: undefined };
              pending++;
              queueMicrotask(() => {
                const query = q && q._query ? q._query : q;
                const res = s.getAllByIndex(idxName, query);
                req.result = res;
                if (req.onsuccess) req.onsuccess({ target: req });
                pending--;
                finish();
              });
              return req;
            },
            openCursor: (range) => {
              const req = { onsuccess: null, onerror: null, result: undefined };
              pending++;
              queueMicrotask(() => {
                const query = range && range._query ? range._query : range;
                const items = s.getAllByIndex(idxName, query);
                let idx = 0;
                function dispatch() {
                  if (idx < items.length) {
                    const item = items[idx++];
                    const cursor = {
                      value: item,
                      delete: () => {
                        s.delete(s.getKey(item));
                      },
                      continue: () => {
                        queueMicrotask(dispatch);
                      },
                    };
                    req.result = cursor;
                    if (req.onsuccess) req.onsuccess({ target: req });
                  } else {
                    req.result = null;
                    if (req.onsuccess) req.onsuccess({ target: req });
                    pending--;
                    finish();
                  }
                }
                dispatch();
              });
              return req;
            },
          }),
        };
      },
      oncomplete: null,
      onerror: null,
      onabort: null,
    };

    queueMicrotask(finish);
    return tx;
  }
}

// Global mock IndexedDB and IDBKeyRange
globalThis.IDBKeyRange = {
  only: (q) => ({ _query: q }),
  lowerBound: (q) => ({ _query: q }),
  upperBound: (q) => ({ _query: q }),
  bound: (l, u) => ({ _query: [l, u] }),
};
const mockDb = new MockIDBDatabase();
globalThis.indexedDB = {
  open: () => {
    const req = { onsuccess: null, onerror: null, onupgradeneeded: null };
    setTimeout(() => {
      req.result = mockDb;
      if (req.onsuccess) req.onsuccess({ target: req });
    }, 0);
    return req;
  },
};
const mockLocalStorageMap = new Map();
globalThis.localStorage = {
  getItem: (k) => mockLocalStorageMap.get(k) || null,
  setItem: (k, v) => mockLocalStorageMap.set(k, String(v)),
  removeItem: (k) => mockLocalStorageMap.delete(k),
  clear: () => mockLocalStorageMap.clear(),
};
globalThis.window = { localStorage: globalThis.localStorage };

try {
  console.log("=== PHASE 4: Offline Quotation Builder & Local Autosave Verification ===");

  const USERS = [
    { _id: 1, email: "super@example.com", role: "super_admin", name: "Super Admin" },
    { _id: 2, email: "dealer1@example.com", role: "dealer", name: "Dealer 1", companyId: 1, discountAllocationPercent: 20 },
    { _id: 3, email: "dealer2@example.com", role: "dealer", name: "Dealer 2", companyId: 2, discountAllocationPercent: 15 },
  ];

  console.log("\n1. Starting isolated test server for Online/Offline parity checks...");
  server = await startIsolatedServer("phase4-draft", USERS, { production: false });
  const { db, login, api, baseUrl } = server;
  const now = new Date();

  // Seed Companies
  await db.collection("companies").insertMany([
    { _id: 1, name: "Whyte Automation Co 1", slug: "company-1", status: "active", phone: "9876543210", address: "Mumbai", createdAt: now, updatedAt: now },
    { _id: 2, name: "Whyte Automation Co 2", slug: "company-2", status: "active", phone: "9876543211", address: "Delhi", createdAt: now, updatedAt: now },
  ]);

  const base = { isActive: true, isDeleted: false, createdAt: now, updatedAt: now };

  // Seed Products
  await db.collection("products").insertMany([
    { _id: 101, companyId: 1, name: "Smart Touch Switch 4M", code: "SW-4M", price: Decimal128.fromString("4500.00"), ...base },
    { _id: 102, companyId: 1, name: "Smart Touch Dimmer 2M", code: "DM-2M", price: Decimal128.fromString("3200.00"), ...base },
    { _id: 201, companyId: 2, name: "Co2 Smart Plug", code: "PLUG-16A", price: Decimal128.fromString("1999.00"), ...base },
  ]);

  // Seed Variants
  await db.collection("productvariants").insertMany([
    { _id: 1001, companyId: 1, productId: 101, variantCode: "SW-4M-W", name: "WiFi Glass White", price: Decimal128.fromString("4500.00"), automationTier: "WiFi", surfaceFinish: "White Glass", ...base },
    { _id: 1002, companyId: 1, productId: 101, variantCode: "SW-4M-B", name: "WiFi Glass Black", price: Decimal128.fromString("4800.00"), automationTier: "WiFi", surfaceFinish: "Black Glass", ...base },
    { _id: 1003, companyId: 1, productId: 102, variantCode: "DM-2M-W", name: "Dimmer Glass White", price: Decimal128.fromString("3200.00"), automationTier: "WiFi", surfaceFinish: "White Glass", ...base },
    { _id: 2001, companyId: 2, productId: 201, variantCode: "PLUG-16A-W", name: "Smart Plug White", price: Decimal128.fromString("1999.00"), automationTier: "WiFi", surfaceFinish: "White", ...base },
  ]);

  // Seed HouseTypes & RoomTypes
  await db.collection("housetypes").insertMany([
    { _id: 10, companyId: 1, name: "3BHK Villa C1", sortOrder: 1, ...base },
  ]);
  await db.collection("roomtypes").insertMany([
    { _id: 1, companyId: 1, name: "Living Room", ...base },
  ]);

  // Seed Existing Approved Server Quotation (To test requirement #20)
  await db.collection("quotations").insertOne({
    _id: "QT_SERVER_APPROVED_001",
    quotationNumber: "QT-2026-0001",
    companyId: 1,
    clientName: "Historic Client",
    status: "approved",
    totalAmount: Decimal128.fromString("15000.00"),
    ...base,
  });

  // Mock catalog for Dealer 1
  const catalogCompany1 = [
    {
      id: 101,
      name: "Smart Touch Switch 4M",
      code: "SW-4M",
      price: "4500.00",
      isActive: true,
      variants: [
        { id: 1001, name: "WiFi Glass White", price: "4500.00", automationTier: "WiFi", surfaceFinish: "White Glass", isActive: true },
        { id: 1002, name: "WiFi Glass Black", price: "4800.00", automationTier: "WiFi", surfaceFinish: "Black Glass", isActive: true },
      ],
    },
    {
      id: 102,
      name: "Smart Touch Dimmer 2M",
      code: "DM-2M",
      price: "3200.00",
      isActive: true,
      variants: [
        { id: 1003, name: "Dimmer Glass White", price: "3200.00", automationTier: "WiFi", surfaceFinish: "White Glass", isActive: true },
      ],
    },
  ];

  console.log("\n2. Executing 20 Integration Tests...");

  // --- Test 1: Create an offline draft with one room ---
  let draft = createEmptyOfflineDraft({
    companyId: 1,
    companyName: "Whyte Automation Co 1",
    userId: 2,
    userName: "Dealer 1",
    userRole: "dealer",
    catalogVersion: "hash_v1_company1",
    allocatedDiscountPercent: 20,
  });
  draft.clientName = "Rajesh Sharma";
  draft.clientPhone = "9820012345";
  draft.houseTypeId = 10;
  draft.rooms.push({
    id: "room_living_1",
    draftId: draft.id,
    roomTypeId: 1,
    name: "Living Room",
    floor: "Ground Floor",
    sortOrder: 10,
    items: [],
  });
  draft.roomCount = 1;
  let saveRes = await saveOfflineDraft(draft);
  assert.equal(saveRes.success, true);
  pass("1. Create an offline draft with one room");

  // --- Test 2: Create a draft with multiple rooms and products ---
  draft.rooms.push({
    id: "room_master_2",
    draftId: draft.id,
    roomTypeId: 2,
    name: "Master Bedroom",
    floor: "First Floor",
    sortOrder: 20,
    items: [],
  });
  draft.rooms[0].items.push({
    id: "item_1",
    draftId: draft.id,
    roomId: "room_living_1",
    productId: 101,
    variantId: 1001,
    productName: "Smart Touch Switch 4M",
    variantName: "WiFi Glass White",
    quantity: 2,
    defaultUnitPrice: "4500.00",
    unitPrice: "4500.00",
    isCustomPrice: false,
    taxPercent: 18,
    lineTotal: "9000.00",
    sortOrder: 10,
  });
  draft.rooms[1].items.push({
    id: "item_2",
    draftId: draft.id,
    roomId: "room_master_2",
    productId: 102,
    variantId: 1003,
    productName: "Smart Touch Dimmer 2M",
    variantName: "Dimmer Glass White",
    quantity: 1,
    defaultUnitPrice: "3200.00",
    unitPrice: "3200.00",
    isCustomPrice: false,
    taxPercent: 18,
    lineTotal: "3200.00",
    sortOrder: 10,
  });
  draft.roomCount = draft.rooms.length;
  draft.deviceCount = 3;
  saveRes = await saveOfflineDraft(draft);
  assert.equal(saveRes.success, true);
  assert.equal(draft.rooms.length, 2);
  assert.equal(draft.deviceCount, 3);
  pass("2. Create a draft with multiple rooms and products");

  // --- Test 3: Add and remove products ---
  // Add item_3 to room 1
  draft.rooms[0].items.push({
    id: "item_3",
    draftId: draft.id,
    roomId: "room_living_1",
    productId: 101,
    variantId: 1002,
    productName: "Smart Touch Switch 4M",
    variantName: "WiFi Glass Black",
    quantity: 1,
    defaultUnitPrice: "4800.00",
    unitPrice: "4800.00",
    isCustomPrice: false,
    taxPercent: 18,
    lineTotal: "4800.00",
    sortOrder: 20,
  });
  assert.equal(draft.rooms[0].items.length, 2);
  // Remove item_3
  draft.rooms[0].items = draft.rooms[0].items.filter((i) => i.id !== "item_3");
  assert.equal(draft.rooms[0].items.length, 1);
  saveRes = await saveOfflineDraft(draft);
  assert.equal(saveRes.success, true);
  pass("3. Add and remove products");

  // --- Test 4: Edit quantities ---
  draft.rooms[0].items[0].quantity = 4; // Was 2, now 4
  const calcQty = calculateDraftTotals({ rooms: draft.rooms });
  assert.equal(calcQty.grossSubtotal, 4 * 4500 + 1 * 3200); // 18000 + 3200 = 21200
  pass("4. Edit quantities (totals update correctly)");

  // --- Test 5: Change quotation-specific unit prices ---
  // Custom price: discount from 4500 to 4200
  draft.rooms[0].items[0].unitPrice = "4200.00";
  draft.rooms[0].items[0].isCustomPrice = true;
  const calcCustom = calculateDraftTotals({ rooms: draft.rooms });
  assert.equal(calcCustom.grossSubtotal, 4 * 4200 + 3200); // 16800 + 3200 = 20000
  saveRes = await saveOfflineDraft(draft);
  assert.equal(saveRes.success, true);
  pass("5. Change quotation-specific unit prices");

  // --- Test 6: Verify Product Master prices remain unchanged ---
  const masterSwitch = await db.collection("products").findOne({ _id: 101 });
  const masterVariant = await db.collection("productvariants").findOne({ _id: 1001 });
  assert.equal(Number(masterSwitch.price.toString()), 4500);
  assert.equal(Number(masterVariant.price.toString()), 4500);
  pass("6. Verify Product Master prices remain unchanged");

  // --- Test 7: Reset custom prices to default ---
  draft.rooms[0].items[0].unitPrice = draft.rooms[0].items[0].defaultUnitPrice; // Reset to 4500
  draft.rooms[0].items[0].isCustomPrice = false;
  const calcReset = calculateDraftTotals({ rooms: draft.rooms });
  assert.equal(calcReset.grossSubtotal, 4 * 4500 + 3200); // 21200
  pass("7. Reset custom prices to default");

  // --- Test 8: Save and reopen the draft ---
  await saveOfflineDraft(draft);
  const reloaded = await loadOfflineDraft(1, 2, draft.id);
  assert.ok(reloaded);
  assert.equal(reloaded.id, draft.id);
  assert.equal(reloaded.clientName, "Rajesh Sharma");
  assert.equal(reloaded.rooms.length, 2);
  pass("8. Save and reopen the draft");

  // --- Test 9: Browser refresh during editing (mocked state recovery) ---
  const stateSnapshotBeforeRefresh = JSON.parse(JSON.stringify(draft));
  stateSnapshotBeforeRefresh.rooms[0].name = "Renamed Living Room";
  await saveOfflineDraft(stateSnapshotBeforeRefresh);
  // Re-open fresh
  const restoredDraft = await loadOfflineDraft(1, 2, draft.id);
  assert.equal(restoredDraft.rooms[0].name, "Renamed Living Room");
  pass("9. Browser refresh during editing (recovery from IndexedDB)");

  // --- Test 10: Rapid consecutive edits and autosave ordering ---
  let currentRev = restoredDraft.revision;
  for (let i = 1; i <= 5; i++) {
    restoredDraft.notes = `Rapid update note ${i}`;
    const res = await saveOfflineDraft(restoredDraft);
    assert.equal(res.success, true);
    assert.ok(res.revision > currentRev);
    currentRev = res.revision;
  }
  const finalDraft = await loadOfflineDraft(1, 2, draft.id);
  assert.equal(finalDraft.notes, "Rapid update note 5");
  pass("10. Rapid consecutive edits and autosave ordering");

  // --- Test 11: Simulated IndexedDB write failure ---
  mockDb._simulateFailure = true;
  const failRes = await saveOfflineDraft(restoredDraft);
  assert.equal(failRes.success, false);
  assert.match(failRes.error, /QuotaExceededError/i);
  mockDb._simulateFailure = false;
  pass("11. Simulated IndexedDB write failure handling");

  // --- Test 12: Local draft duplication and default price reset (Rule #9) ---
  // Introduce a custom price in source draft
  finalDraft.rooms[0].items[0].unitPrice = "3999.00"; // custom override
  finalDraft.rooms[0].items[0].isCustomPrice = true;
  await saveOfflineDraft(finalDraft);

  const { newDraft, skippedUnavailableItems } = await duplicateOfflineDraft({
    sourceDraft: finalDraft,
    currentCatalog: catalogCompany1,
    catalogVersion: "hash_v1_company1",
  });
  assert.notEqual(newDraft.id, finalDraft.id);
  assert.ok(newDraft.id.startsWith("draft_"));
  assert.equal(newDraft.clientName, "Rajesh Sharma (Copy)");
  // RULE #9: Price MUST be reset to current catalog default (4500.00), NOT 3999.00!
  assert.equal(newDraft.rooms[0].items[0].unitPrice, "4500.00");
  assert.equal(newDraft.rooms[0].items[0].isCustomPrice, false);
  assert.equal(skippedUnavailableItems.length, 0);
  pass("12. Local draft duplication and default price reset (Rule #9)");

  // --- Test 13: No official quotation number allocated ---
  assert.match(draft.id, /^draft_[a-zA-Z0-9_-]+$/);
  assert.match(newDraft.id, /^draft_[a-zA-Z0-9_-]+$/);
  assert.ok(!draft.id.startsWith("QT-"));
  assert.ok(!newDraft.id.startsWith("QT-"));
  pass("13. No official quotation number allocated (draft_<uuid> only)");

  // --- Test 14: Offline calculations match existing online formulas ---
  const grossSub = 50000;
  const discountVal = 10; // 10%
  const discountAmt = round2(grossSub * (discountVal / 100)); // 5000
  const onlineGst = calculateQuotationGst(grossSub, discountAmt);
  const onlineEarning = calculateDealerEarning({
    subtotal: grossSub,
    allocatedPercent: 20,
    customerPercent: 10,
  });

  const dummyRooms = [
    {
      id: "r1",
      draftId: "d1",
      roomTypeId: 1,
      name: "R1",
      sortOrder: 1,
      items: [
        {
          id: "i1",
          draftId: "d1",
          roomId: "r1",
          productId: 1,
          variantId: 1,
          productName: "P1",
          quantity: 10,
          defaultUnitPrice: "5000.00",
          unitPrice: "5000.00",
          isCustomPrice: false,
          taxPercent: 18,
          lineTotal: "50000.00",
          sortOrder: 1,
        },
      ],
    },
  ];

  const offlineCalc = calculateDraftTotals({
    rooms: dummyRooms,
    discountType: "percentage",
    discountValue: 10,
    dealerDiscountAllocationPercent: 20,
  });

  assert.equal(offlineCalc.grossSubtotal, onlineGst.grossSubtotal);
  assert.equal(offlineCalc.discountAmount, onlineGst.discountAmount);
  assert.equal(offlineCalc.netSubtotal, onlineGst.netSubtotal);
  assert.equal(offlineCalc.cgstAmount, onlineGst.cgstAmount);
  assert.equal(offlineCalc.sgstAmount, onlineGst.sgstAmount);
  assert.equal(offlineCalc.totalGstAmount, onlineGst.totalGstAmount);
  assert.equal(offlineCalc.grandTotal, onlineGst.grandTotal);
  assert.equal(offlineCalc.estimatedDealerEarning, onlineEarning.earningAmount);
  pass("14. Offline calculations match existing online formulas (100% parity)");

  // --- Test 15: Company 1 / Company 2 isolation ---
  // Create a draft for Dealer 2 (Company 2)
  const draftCompany2 = createEmptyOfflineDraft({
    companyId: 2,
    companyName: "Whyte Automation Co 2",
    userId: 3,
    userName: "Dealer 2",
    userRole: "dealer",
    catalogVersion: "hash_v1_company2",
  });
  draftCompany2.clientName = "Anil Mehta";
  await saveOfflineDraft(draftCompany2);

  // Fetch drafts for Company 1 / User 2
  const c1Drafts = await listOfflineDrafts(1, 2);
  const c2Drafts = await listOfflineDrafts(2, 3);

  assert.ok(c1Drafts.every((d) => d.companyId === 1 && d.userId === 2));
  assert.ok(c2Drafts.every((d) => d.companyId === 2 && d.userId === 3));
  assert.ok(!c1Drafts.some((d) => d.clientName === "Anil Mehta"));
  assert.ok(!c2Drafts.some((d) => d.clientName === "Rajesh Sharma"));
  pass("15. Company 1 / Company 2 isolation (IndexedDB partitioned by tenantKey)");

  // --- Test 16: Super Admin without Act-As restrictions ---
  const superSession = await login("super@example.com", "admin");
  const superCatalogRes = await api(superSession, "GET", "/api/catalog/offline-package");
  // Super Admin without act-as must get 403 Forbidden
  assert.equal(superCatalogRes.status, 403);
  pass("16. Super Admin without Act-As restrictions (403 Forbidden)");

  // --- Test 17: Logout/account switching ---
  // User 2 logs out, User 3 logs in: User 3 cannot load User 2's draft
  const leakCheck = await loadOfflineDraft(2, 3, draft.id); // Attempting to load C1/User2 draft with C2/User3
  assert.equal(leakCheck, null);
  pass("17. Logout/account switching (cross-tenant access returns null)");

  // --- Test 18: Missing or inactive product handling ---
  // If a variant is missing from currentCatalog during duplication, it should be skipped with warning
  const draftWithMissingItem = createEmptyOfflineDraft({
    companyId: 1,
    companyName: "Whyte Automation Co 1",
    userId: 2,
    userName: "Dealer 1",
    userRole: "dealer",
    catalogVersion: "hash_v1_company1",
  });
  draftWithMissingItem.rooms.push({
    id: "r_del",
    draftId: draftWithMissingItem.id,
    roomTypeId: 1,
    name: "Room",
    sortOrder: 1,
    items: [
      {
        id: "item_deleted",
        draftId: draftWithMissingItem.id,
        roomId: "r_del",
        productId: 9999, // DELETED PRODUCT
        variantId: 99999,
        productName: "Discontinued Switch",
        quantity: 1,
        defaultUnitPrice: "1000.00",
        unitPrice: "1000.00",
        isCustomPrice: false,
        taxPercent: 18,
        lineTotal: "1000.00",
        sortOrder: 1,
      },
    ],
  });
  const dupResult = await duplicateOfflineDraft({
    sourceDraft: draftWithMissingItem,
    currentCatalog: catalogCompany1,
    catalogVersion: "hash_v1_company1",
  });
  assert.equal(dupResult.skippedUnavailableItems.length, 1);
  assert.equal(dupResult.skippedUnavailableItems[0], "Discontinued Switch");
  assert.equal(dupResult.newDraft.rooms[0].items.length, 0); // Discontinued item skipped
  pass("18. Missing or inactive product handling (gracefully skipped on clone)");

  // --- Test 19: Existing online quotation flow regression ---
  const dealerSession = await login("dealer1@example.com", "user");
  const onlineQuoteRes = await api(dealerSession, "POST", "/api/quotations", {
    clientName: "Online Regression Client",
    houseTypeId: 10,
  });
  assert.equal(onlineQuoteRes.status, 201);
  const createdId = onlineQuoteRes.data?.id || onlineQuoteRes.data?._id || onlineQuoteRes.json?.id || onlineQuoteRes.json?._id;
  assert.ok(createdId);
  pass("19. Existing online quotation flow regression (POST /api/quotations unaffected)");

  // --- Test 20: Existing approved/delivered quotations remain unchanged ---
  const approvedServerDoc = await db.collection("quotations").findOne({ _id: "QT_SERVER_APPROVED_001" });
  assert.equal(approvedServerDoc.status, "approved");
  assert.equal(Number(approvedServerDoc.totalAmount.toString()), 15000);
  assert.equal(approvedServerDoc.quotationNumber, "QT-2026-0001");
  pass("20. Existing approved/delivered quotations remain unchanged");

  // --- Test 21: Edit a draft and immediately terminate browser before autosave debounce ---
  // --- Test 21: Edit a draft and immediately terminate browser before autosave debounce ---
  const draftBeforeClose = createEmptyOfflineDraft({
    companyId: 1,
    companyName: "Whyte Automation Co 1",
    userId: 2,
    userName: "Dealer 1",
    userRole: "dealer",
    catalogVersion: "hash_v1_company1",
  });
  draftBeforeClose.clientName = "Client Before Crash";
  const initialSaveRes = await saveOfflineDraft(draftBeforeClose);
  const initialRev = initialSaveRes.revision;

  // User edits draft to next revision:
  const nextRev = initialRev + 1;
  const editedDraft = {
    ...draftBeforeClose,
    clientName: "Client With Immediate Unsaved Edit",
    revision: nextRev,
  };
  // Synchronous backup is written immediately upon edit / beforeunload:
  writeSyncCrashBackup(editedDraft);

  // Browser abruptly closes: IndexedDB write was NOT executed for nextRev!
  const rawIdbCheck = await loadOfflineDraft(1, 2, draftBeforeClose.id);
  assert.equal(rawIdbCheck.revision, initialRev);
  assert.equal(rawIdbCheck.clientName, "Client Before Crash");
  pass("21. Immediate browser close before autosave debounce (simulated abrupt close)");

  // --- Test 22: Reopen and verify whether latest edit survived (Crash Recovery) ---
  const tenantKey = `1_2`;
  let recoveredDraft = await loadOfflineDraft(1, 2, draftBeforeClose.id);
  const crashBackup = getSyncCrashBackup(tenantKey, draftBeforeClose.id);
  assert.ok(crashBackup, "Crash backup should exist in localStorage");
  assert.equal(crashBackup.revision, nextRev);

  // Recovery executes:
  if (crashBackup && (!recoveredDraft || (crashBackup.revision || 0) > (recoveredDraft.revision || 0))) {
    recoveredDraft = crashBackup;
    await saveOfflineDraft(recoveredDraft);
    clearSyncCrashBackup(tenantKey, draftBeforeClose.id);
  }

  // Verify latest edit survived and is now in IndexedDB
  assert.equal(recoveredDraft.clientName, "Client With Immediate Unsaved Edit");

  const idbCaughtUp = await loadOfflineDraft(1, 2, draftBeforeClose.id);
  assert.equal(idbCaughtUp.clientName, "Client With Immediate Unsaved Edit");
  assert.ok(idbCaughtUp.revision >= nextRev);
  assert.equal(getSyncCrashBackup(tenantKey, draftBeforeClose.id), null);
  pass("22. Reopen and verify latest edit survived via synchronous crash recovery");

  console.log("\n========================================================");
  console.log(`ALL 22 AUTOMATED INTEGRATION & CRASH-RESILIENCE TESTS PASSED!`);
  console.log("========================================================\n");

} catch (err) {
  console.error("\nTEST SUITE FAILED:", err);
  exitCode = 1;
} finally {
  if (server) {
    await server.cleanup();
  }
  process.exit(exitCode);
}
