const dns = require("dns");
dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);
const { MongoClient } = require("mongodb");

async function main() {
  const uri = process.env.MONGODB_URI || "mongodb+srv://root:root@cluster0.yvhpxeg.mongodb.net/whyte_quotation";
  const client = new MongoClient(uri);

  try {
    await client.connect();
    const db = client.db("whyte_quotation");

    const totalVariants = await db.collection("productvariants").countDocuments();
    const totalProducts = await db.collection("products").countDocuments();
    const totalQuotationItems = await db.collection("quotationitems").countDocuments();

    console.log(`Total ProductVariants: ${totalVariants}`);
    console.log(`Total Products: ${totalProducts}`);
    console.log(`Total QuotationItems: ${totalQuotationItems}`);

    // Sample 5 ProductVariants
    const sampleVariants = await db.collection("productvariants").find().limit(5).toArray();
    console.log("\n--- Sample 5 ProductVariants ---");
    console.log(JSON.stringify(sampleVariants, null, 2));

    // Check if any variant has taxPercent or priceWithoutTax
    const variantsWithNewFields = await db.collection("productvariants").countDocuments({
      $or: [
        { priceWithoutTax: { $exists: true } },
        { taxPercent: { $exists: true } },
        { cost: { $exists: true } },
        { purchaseTaxPercent: { $exists: true } }
      ]
    });
    console.log(`\nVariants with any new pricing fields: ${variantsWithNewFields} / ${totalVariants}`);

    // Inspect fields on Products collection
    const sampleProducts = await db.collection("products").find().limit(3).toArray();
    console.log("\n--- Sample 3 Products ---");
    console.log(JSON.stringify(sampleProducts, null, 2));

    // Check product-level pricing fields
    const productsWithPrice = await db.collection("products").countDocuments({ price: { $exists: true } });
    const productsWithTax = await db.collection("products").countDocuments({ tax: { $exists: true } });
    const productsWithSalesTax = await db.collection("products").countDocuments({ salesTaxPercent: { $exists: true } });
    const productsWithCost = await db.collection("products").countDocuments({ cost: { $exists: true } });
    const productsWithPurchaseTax = await db.collection("products").countDocuments({ purchaseTaxPercent: { $exists: true } });

    console.log(`\nProducts with price: ${productsWithPrice} / ${totalProducts}`);
    console.log(`Products with tax: ${productsWithTax}`);
    console.log(`Products with salesTaxPercent: ${productsWithSalesTax}`);
    console.log(`Products with cost: ${productsWithCost}`);
    console.log(`Products with purchaseTaxPercent: ${productsWithPurchaseTax}`);

    // Sample 3 QuotationItems
    const sampleItems = await db.collection("quotationitems").find().limit(3).toArray();
    console.log("\n--- Sample 3 QuotationItems ---");
    console.log(JSON.stringify(sampleItems, null, 2));

  } finally {
    await client.close();
  }
}

main().catch(console.error);
