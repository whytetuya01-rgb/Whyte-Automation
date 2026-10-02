import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
import { connectMongoDB } from "../src/lib/mongodb";
import mongoose from "mongoose";
import { Product, ProductVariant, QuotationItem } from "../src/models";

async function checkRef() {
  await connectMongoDB();
  const prods = await Product.find({ _id: { $in: [44, 56] } }).lean();
  console.log("Referenced Products in DB:");
  console.log(JSON.stringify(prods, null, 2));

  const vars = await ProductVariant.find({ _id: { $in: [1, 73] } }).lean();
  console.log("Referenced ProductVariants in DB:");
  console.log(JSON.stringify(vars, null, 2));

  const items = await QuotationItem.find().lean();
  console.log("All 6 QuotationItems:");
  console.log(JSON.stringify(items, null, 2));

  await mongoose.disconnect();
}
checkRef();
