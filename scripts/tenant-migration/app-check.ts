/**
 * Read-only application-level check: runs the REAL Mongoose models (tenant plugin active) in each user context and
 * prints what each would see. Use it on a rehearsal copy before and after the migration; it never writes.
 *
 *   WHYTE_MIGRATION_URI=<uri> WHYTE_MIGRATION_DB=<db> npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register scripts/tenant-migration/app-check.ts
 */
import mongoose from "mongoose";
import { Product, ProductVariant, Category, HouseType, RoomType, Quotation, QuotationItem } from "@/models";
import { runWithTenantContext } from "@/lib/tenant/context";

type Ctx = Parameters<typeof runWithTenantContext>[0];
const ctx = (o: Partial<Ctx> & { companyId: number | null }): Ctx => ({ userId: 1, role: "admin", actingAsCompany: false, ...o } as Ctx);

(async () => {
  const uri = process.env.WHYTE_MIGRATION_URI, db = process.env.WHYTE_MIGRATION_DB;
  if (!uri || !db) throw new Error("WHYTE_MIGRATION_URI and WHYTE_MIGRATION_DB are required");
  await mongoose.connect(uri, { dbName: db, bufferCommands: false, autoIndex: false, autoCreate: false });
  const contexts: Array<[string, Ctx]> = [
    ["Company 1 admin/dealer (companyId 1)", ctx({ companyId: 1 })],
    ["Company 2 (companyId 2, isolation probe)", ctx({ companyId: 2 })],
    ["Super Admin, no act-as (companyId null)", ctx({ companyId: null, role: "super_admin" })],
  ];
  for (const [label, c] of contexts) {
    await runWithTenantContext(c, async () => {
      const products = await Product.find({ isActive: true, isDeleted: { $ne: true } }).lean();
      const withImage = products.filter((p: any) => p.imageUrl).length;
      const items = await QuotationItem.find({}).populate("product").lean({ virtuals: true });
      const itemsWithProduct = items.filter((i: any) => i.product).length;
      const itemsWithImage = items.filter((i: any) => i.product?.imageUrl).length;
      console.log(`${label}\n  products(active) ${products.length} (with image ${withImage}) | variants ${await ProductVariant.countDocuments({})} | categories ${await Category.countDocuments({})} | houseTypes ${await HouseType.countDocuments({})} | roomTypes ${await RoomType.countDocuments({})} | quotations ${await Quotation.countDocuments({})}\n  quotation items ${items.length}: product resolved ${itemsWithProduct}, with image ${itemsWithImage}`);
    });
  }
  await mongoose.disconnect();
})().catch((e) => { console.error(String(e.message).replace(/mongodb(\+srv)?:\/\/\S+/g, "<uri>")); process.exit(1); });
