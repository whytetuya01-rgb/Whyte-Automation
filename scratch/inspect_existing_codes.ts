import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
import { connectMongoDB } from "../src/lib/mongodb";
import mongoose from "mongoose";
import { Product } from "../src/models";

async function inspectCodes() {
  await connectMongoDB();
  const prods = await Product.find().sort({ _id: 1 }).lean();
  console.log("Total DB products:", prods.length);
  const withCode = prods.filter(p => p.code);
  console.log("Products with code in DB:", withCode.length);
  console.log("Products with null code in DB:", prods.length - withCode.length);
  console.log("Sample codes in DB (first 20):");
  withCode.slice(0, 20).forEach(p => console.log(`ID: ${p._id} | Code: "${p.code}" | Name: "${p.name}" | Notes: "${p.notes}"`));
  await mongoose.disconnect();
}
inspectCodes();
