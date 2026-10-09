/**
 * READ-ONLY: dumps the HouseType collection to confirm whether the dropdown
 * options come from the database or elsewhere.
 *
 *   node scripts/run-script.js scripts/audit/dump-house-types.ts
 */
import mongoose from "mongoose";
import { connectMongoDB } from "../../src/lib/mongodb";
import { HouseType } from "../../src/models";

async function main() {
  await connectMongoDB();
  const rows = await HouseType.find().sort({ sortOrder: 1 }).lean();
  console.log(`Total HouseType documents: ${rows.length}\n`);
  rows.forEach((r: any) => {
    console.log(`#${r._id} name="${r.name}" description="${r.description ?? ""}" isActive=${r.isActive} sortOrder=${r.sortOrder}`);
  });
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
