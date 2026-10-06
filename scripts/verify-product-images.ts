import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
if (fs.existsSync(path.resolve(process.cwd(), ".env.local"))) {
  dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), override: true });
}

import { connectMongoDB } from "../src/lib/mongodb";
import { Product } from "../src/models";

async function verifyProductImages() {
  console.log("\n========================================");
  console.log("PRODUCT IMAGE VERIFICATION REPORT");
  console.log("========================================\n");

  await connectMongoDB();

  const products = await Product.find().sort({ _id: 1 });
  const total = products.length;

  let noImageCount = 0;
  let localImageCount = 0;
  let cloudinaryImageCount = 0;
  let hasPublicIdCount = 0;
  let missingPublicIdForCloudinary = 0;
  let invalidUrlCount = 0;

  const localDirPublic = path.resolve(process.cwd(), "public/whyte_catalog_images");

  const issues: string[] = [];

  for (const p of products) {
    const url = p.imageUrl ? p.imageUrl.trim() : null;
    const publicId = p.imagePublicId ? p.imagePublicId.trim() : null;

    if (publicId) {
      hasPublicIdCount++;
    }

    if (!url) {
      noImageCount++;
      continue;
    }

    if (url.startsWith("/whyte_catalog_images/") || url.startsWith("whyte_catalog_images/")) {
      localImageCount++;
      const fileName = path.basename(url);
      const existsOnDisk = fs.existsSync(path.join(localDirPublic, fileName));
      if (!existsOnDisk) {
        issues.push(`Product #${p._id} ("${p.name}") references local image '${fileName}' which DOES NOT exist in public/whyte_catalog_images/`);
      }
    } else if (url.includes("res.cloudinary.com")) {
      cloudinaryImageCount++;
      if (!publicId) {
        missingPublicIdForCloudinary++;
        issues.push(`Product #${p._id} ("${p.name}") has Cloudinary URL but is MISSING imagePublicId.`);
      }
    } else if (/^https?:\/\//i.test(url)) {
      issues.push(`Product #${p._id} ("${p.name}") has external non-Cloudinary URL: ${url}`);
    } else {
      invalidUrlCount++;
      issues.push(`Product #${p._id} ("${p.name}") has unrecognised/invalid imageUrl: ${url}`);
    }
  }

  console.log(`Total Products: ${total}`);
  console.log(`No Image Assigned: ${noImageCount}`);
  console.log(`Local Images (/whyte_catalog_images/): ${localImageCount}`);
  console.log(`Cloudinary Images (res.cloudinary.com): ${cloudinaryImageCount}`);
  console.log(`Products with imagePublicId: ${hasPublicIdCount}`);
  console.log(`Cloudinary URLs missing imagePublicId: ${missingPublicIdForCloudinary}`);
  console.log(`Invalid / Unrecognised URLs: ${invalidUrlCount}`);
  console.log(`Total Issues Detected: ${issues.length}`);

  if (issues.length > 0) {
    console.log("\nIssue Breakdown:");
    issues.forEach((issue) => console.log(` ❌ ${issue}`));
  } else {
    console.log("\n✅ All product image references are clean and valid!");
  }

  console.log("\n========================================\n");
  await mongoose.disconnect();
}

verifyProductImages().catch((err) => {
  console.error("Verification script failed:", err);
  process.exit(1);
});
