/**
 * Adds the 5 house types that were previously hardcoded in the proposal
 * builder's dropdown (StepProjectDetails.tsx) but never existed as real
 * HouseType records, so they become manageable from /admin/house-types
 * exactly like the other 7.
 *
 *   node scripts/run-script.js scripts/audit/add-missing-house-types.ts
 */
import mongoose from "mongoose";
import { connectMongoDB } from "../../src/lib/mongodb";
import { HouseType } from "../../src/models";
import { getNextSequence } from "../../src/lib/counter";

const NEW_HOUSE_TYPES = [
  { name: "Residential / Apartment", description: "Standard residential apartment", sortOrder: 70 },
  { name: "Luxury Villa", description: "Premium villa with luxury specification", sortOrder: 80 },
  { name: "Commercial / Retail", description: "Commercial or retail space", sortOrder: 90 },
  { name: "Corporate Office", description: "Corporate office space", sortOrder: 100 },
  { name: "Hospitality / Hotel", description: "Hotel or hospitality project", sortOrder: 110 },
];

async function main() {
  await connectMongoDB();

  for (const ht of NEW_HOUSE_TYPES) {
    const existing = await HouseType.findOne({ name: ht.name }).lean();
    if (existing) {
      console.log(`[SKIP] "${ht.name}" already exists as #${existing._id}`);
      continue;
    }
    const id = await getNextSequence("houseType", HouseType);
    await new HouseType({
      _id: id,
      name: ht.name,
      description: ht.description,
      isActive: true,
      sortOrder: ht.sortOrder,
    }).save();
    console.log(`[CREATED] #${id} "${ht.name}"`);
  }

  const all = await HouseType.find().sort({ sortOrder: 1 }).lean();
  console.log(`\nTotal HouseType documents now: ${all.length}`);
  all.forEach((r: any) => console.log(`  #${r._id} "${r.name}" sortOrder=${r.sortOrder}`));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
