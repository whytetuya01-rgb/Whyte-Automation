import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
import { connectMongoDB } from "../src/lib/mongodb";
import mongoose from "mongoose";
import { ProductVariant } from "../src/models";

async function testVariantCode() {
  await connectMongoDB();
  const v = await ProductVariant.findOne({ _id: 1 });
  console.log("Current Variant 1 in DB:", {
    id: v?._id,
    variantCode: v?.variantCode,
    price: v?.price,
    automationTier: v?.automationTier,
    surfaceFinish: v?.surfaceFinish
  });
  await mongoose.disconnect();
}
testVariantCode();
