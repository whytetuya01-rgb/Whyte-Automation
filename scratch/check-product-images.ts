import { connectMongoDB } from "../src/lib/mongodb";
import { Product } from "../src/models";

async function check() {
  await connectMongoDB();
  const products = await Product.find().lean();
  console.log("Total products in MongoDB:", products.length);

  const withImages = products.filter((p) => p.imageUrl);
  console.log("Products with non-null imageUrl:", withImages.length);

  console.log("\nFirst 20 products in DB:");
  products.slice(0, 20).forEach((p) => {
    console.log(` - ID: ${p._id}, Name: "${p.name}", imageUrl: "${p.imageUrl}", imagePublicId: "${p.imagePublicId ?? null}"`);
  });

  if (withImages.length > 0) {
    console.log("\nSample with images:");
    withImages.slice(0, 10).forEach((p) => {
      console.log(` - ID: ${p._id}, Name: "${p.name}", imageUrl: "${p.imageUrl}"`);
    });
  }

  process.exit(0);
}

check();
