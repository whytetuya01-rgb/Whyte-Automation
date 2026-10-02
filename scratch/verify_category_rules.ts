import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
import { connectMongoDB } from "../src/lib/mongodb";
import mongoose from "mongoose";
import { Product } from "../src/models";

async function verifyCategoryRules() {
  await connectMongoDB();
  const prods = await Product.find().lean();
  let mismatches = 0;

  for (const p of prods) {
    const note = p.notes || "";
    // Note format: "Catalog: Tactus_X" or "Catalog: Tactus Color_X" etc.
    const match = note.match(/Catalog:\s*(.+?)_(\d+)/);
    if (!match) continue;
    const fam = match[1];
    const itemNo = parseInt(match[2], 10);

    let expectedCat = 1;
    let expectedType = "switch_board";

    if (fam === "Tactus") {
      if (itemNo === 7 || itemNo === 8) {
        expectedCat = 1;
        expectedType = "curtain";
      } else if (itemNo >= 83) {
        expectedCat = 6;
        expectedType = "accessory";
      } else {
        expectedCat = 1;
        expectedType = "switch_board";
      }
    } else if (fam === "Tactus Color") {
      if (itemNo === 7 || itemNo === 8) {
        expectedCat = 1;
        expectedType = "curtain";
      } else {
        expectedCat = 1;
        expectedType = "switch_board";
      }
    } else if (fam === "Tactus Color EDGE") {
      if (itemNo === 7 || itemNo === 8) {
        expectedCat = 2;
        expectedType = "curtain";
      } else {
        expectedCat = 2;
        expectedType = "switch_board";
      }
    } else if (fam === "Tactus VLUXE") {
      if (itemNo === 7 || itemNo === 8) {
        expectedCat = 3;
        expectedType = "curtain";
      } else {
        expectedCat = 3;
        expectedType = "switch_board";
      }
    }

    if (p.categoryId !== expectedCat || p.type !== expectedType) {
      console.log(`Mismatch on ${fam} #${itemNo}: DB has cat=${p.categoryId}, type=${p.type} | Expected: cat=${expectedCat}, type=${expectedType}`);
      mismatches++;
    }
  }

  console.log(`Total mismatches between rule and current DB: ${mismatches} / ${prods.length}`);
  await mongoose.disconnect();
}
verifyCategoryRules();
