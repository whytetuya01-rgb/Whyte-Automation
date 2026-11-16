import dns from "dns";
dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);
import mongoose from "mongoose";

const MONGODB_URI =
  process.env.MONGODB_URI ||
  "mongodb+srv://whyte_migrator:MLVQbe0pdAdG4vCy@cluster0.yvhpxeg.mongodb.net/whyte_quotation";

async function main() {
  console.log("Connecting to MongoDB...");
  await mongoose.connect(MONGODB_URI);
  console.log("Connected successfully.\n");

  const db = mongoose.connection.db!;
  const roomTypesColl = db.collection("roomtypes");
  const quotationRoomsColl = db.collection("quotationrooms");
  const houseTypeTemplatesColl = db.collection("housetyperoomtemplates");
  const roomTemplatesColl = db.collection("roomtemplates");

  const allRoomTypes = await roomTypesColl.find({}).toArray();
  console.log(`Total RoomType records in DB: ${allRoomTypes.length}`);

  // Group by companyId and normalized name
  const groups: Record<string, any[]> = {};
  for (const rt of allRoomTypes) {
    const compKey = rt.companyId !== undefined && rt.companyId !== null ? String(rt.companyId) : "global";
    const nameKey = (rt.name || "").trim().toLowerCase();
    const groupKey = `${compKey}:::${nameKey}`;
    if (!groups[groupKey]) groups[groupKey] = [];
    groups[groupKey].push(rt);
  }

  let totalDuplicatesFound = 0;
  let totalDuplicatesDeleted = 0;
  let quotationRoomsUpdated = 0;
  let houseTypeTemplatesUpdated = 0;
  let roomTemplatesUpdated = 0;

  for (const [key, records] of Object.entries(groups)) {
    if (records.length <= 1) continue;

    totalDuplicatesFound += records.length - 1;
    const [compKey, nameKey] = key.split(":::");
    console.log(`\nDuplicate group: [${nameKey}] in company [${compKey}] (${records.length} records):`);
    for (const r of records) {
      console.log(`  - ID: ${r._id}, name: "${r.name}", isActive: ${r.isActive}, isDeleted: ${r.isDeleted}`);
    }

    // Determine the single keeper ID:
    // Check if any record is referenced in quotationrooms or housetyperoomtemplates
    let keeper = records.find((r) => r.isActive === true && !r.isDeleted);
    if (!keeper) {
      keeper = records[0];
    }
    // If one of the records has the lower ID (original seeded ID like 17-42), prefer keeping that one
    const originalSeeded = records.find((r) => r._id <= 42);
    if (originalSeeded) {
      keeper = originalSeeded;
    }

    const keeperId = keeper._id;
    console.log(`  ==> KEEPER: ID ${keeperId} ("${keeper.name}")`);

    // Ensure the keeper is marked isActive: true
    await roomTypesColl.updateOne({ _id: keeperId }, { $set: { isActive: true, isDeleted: false } });

    // Process all duplicate records
    const duplicateIds = records.map((r) => r._id).filter((id) => id !== keeperId);

    for (const dupId of duplicateIds) {
      // Re-point QuotationRooms
      const qrRes = await quotationRoomsColl.updateMany(
        { roomTypeId: dupId },
        { $set: { roomTypeId: keeperId } }
      );
      if (qrRes.modifiedCount > 0) {
        quotationRoomsUpdated += qrRes.modifiedCount;
        console.log(`    Updated ${qrRes.modifiedCount} quotationrooms from ID ${dupId} to ${keeperId}`);
      }

      // Re-point HouseTypeRoomTemplates
      const htRes = await houseTypeTemplatesColl.updateMany(
        { roomTypeId: dupId },
        { $set: { roomTypeId: keeperId } }
      );
      if (htRes.modifiedCount > 0) {
        houseTypeTemplatesUpdated += htRes.modifiedCount;
        console.log(`    Updated ${htRes.modifiedCount} housetyperoomtemplates from ID ${dupId} to ${keeperId}`);
      }

      // Re-point RoomTemplates
      const rtRes = await roomTemplatesColl.updateMany(
        { roomTypeId: dupId },
        { $set: { roomTypeId: keeperId } }
      );
      if (rtRes.modifiedCount > 0) {
        roomTemplatesUpdated += rtRes.modifiedCount;
        console.log(`    Updated ${rtRes.modifiedCount} roomtemplates from ID ${dupId} to ${keeperId}`);
      }

      // HARD DELETE the duplicate RoomType
      const delRes = await roomTypesColl.deleteOne({ _id: dupId });
      if (delRes.deletedCount > 0) {
        totalDuplicatesDeleted += delRes.deletedCount;
        console.log(`    HARD DELETED duplicate RoomType ID ${dupId}`);
      }
    }
  }

  console.log("\n================ SUMMARY ================");
  console.log(`Total duplicate records found: ${totalDuplicatesFound}`);
  console.log(`Total duplicate records hard deleted: ${totalDuplicatesDeleted}`);
  console.log(`Quotation rooms re-pointed: ${quotationRoomsUpdated}`);
  console.log(`House type templates re-pointed: ${houseTypeTemplatesUpdated}`);
  console.log(`Room templates re-pointed: ${roomTemplatesUpdated}`);

  const remainingCount = await roomTypesColl.countDocuments();
  console.log(`Remaining unique RoomType records in DB: ${remainingCount}`);
  console.log("=========================================\n");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

