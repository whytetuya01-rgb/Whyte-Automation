import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { connectMongoDB } from "../../src/lib/mongodb";
import {
  Category,
  Product,
  ProductVariant,
  HouseType,
  HouseTypeRoomTemplate,
  RoomType,
  Company,
  Quotation,
  QuotationRoom,
  QuotationItem,
  AdminUser,
  QuotationAuditEvent,
} from "../../src/models";

/**
 * READ-ONLY Phase 0 baseline report.
 *
 * Only `countDocuments()` calls — no document is ever read, no field is ever
 * printed. Safe to run against the real database: it cannot leak customer
 * data and cannot write anything.
 */
async function main() {
  await connectMongoDB();

  const [
    categories,
    products,
    activeProducts,
    matrixProducts,
    variants,
    activeVariants,
    houseTypes,
    roomTemplates,
    roomTypes,
    companies,
    quotations,
    quotationsByStatus,
    rooms,
    items,
    adminUsers,
    adminUsersByRole,
    auditEvents,
  ] = await Promise.all([
    Category.countDocuments(),
    Product.countDocuments(),
    Product.countDocuments({ isActive: true }),
    Product.countDocuments({ isMatrix: true }),
    ProductVariant.countDocuments(),
    ProductVariant.countDocuments({ isActive: true }),
    HouseType.countDocuments(),
    HouseTypeRoomTemplate.countDocuments(),
    RoomType.countDocuments(),
    Company.countDocuments(),
    Quotation.countDocuments(),
    Quotation.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$status", n: { $sum: 1 } } }]),
    QuotationRoom.countDocuments(),
    QuotationItem.countDocuments(),
    AdminUser.countDocuments(),
    AdminUser.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$role", n: { $sum: 1 } } }]),
    QuotationAuditEvent.countDocuments(),
  ]);

  console.log("=== Phase 0: Database counts (read-only) ===");
  console.log(`Categories:            ${categories}`);
  console.log(`Products:              ${products}  (active: ${activeProducts}, matrix: ${matrixProducts})`);
  console.log(`ProductVariants:       ${variants}  (active: ${activeVariants})`);
  console.log(`HouseTypes:            ${houseTypes}`);
  console.log(`HouseTypeRoomTemplate: ${roomTemplates}`);
  console.log(`RoomTypes:             ${roomTypes}`);
  console.log(`Company docs:         ${companies}`);
  console.log(`Quotations:            ${quotations}`);
  for (const row of quotationsByStatus) {
    console.log(`  status=${row._id ?? "(null)"}: ${row.n}`);
  }
  console.log(`QuotationRooms:        ${rooms}`);
  console.log(`QuotationItems:        ${items}`);
  console.log(`AdminUsers:            ${adminUsers}`);
  for (const row of adminUsersByRole) {
    console.log(`  role=${row._id ?? "(null)"}: ${row.n}`);
  }
  console.log(`QuotationAuditEvents:  ${auditEvents}`);

  process.exit(0);
}

main().catch((error) => {
  console.error("db-counts-report failed:", error);
  process.exit(1);
});
