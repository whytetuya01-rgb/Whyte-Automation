/**
 * Connects with every model loaded, waits, and prints how many collections the database has afterwards. It exists to show
 * what the index policy does: with MONGOOSE_AUTO_INDEX=1 connecting creates a collection per model, with =0 it creates none.
 * Used by tests/index-deployment-cli.test.mjs. Refuses any database that is not on this machine.
 */
export {};

async function main() {
  const uri = process.env.MONGODB_URI ?? "";
  const host = (uri.match(/^mongodb:\/\/(?:[^@/]*@)?([^/:,?]+)/)?.[1] ?? "").toLowerCase();
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    console.error("Refusing to run: this probe may only use a MongoDB on this machine.");
    process.exit(2);
  }
  const { loadAllModels } = await import("../../scripts/lib/indexAudit");
  const { connectMongoDB } = await import("../../src/lib/mongodb");
  const models = await loadAllModels();
  const mongoose = await connectMongoDB();
  await Promise.all(models.map((model) => model.init().catch(() => undefined)));
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const collections = await mongoose.connection.db!.listCollections().toArray();
  console.log(JSON.stringify({ collections: collections.length }));
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
