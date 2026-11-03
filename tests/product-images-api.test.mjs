/**
 * Product pictures through the real API (production-mode server + throwaway local MongoDB):
 *   - a product holds up to six pictures, cover first; the older single-image fields follow the cover;
 *   - a new uploaded picture must belong to the caller's company; legacy (single-image) products and older clients keep working;
 *   - a variant can have its own optional picture, and editing it never disturbs its tier, finish or price.
 *
 *   node tests/product-images-api.test.mjs
 */
import assert from "node:assert/strict";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let exitCode = 0;
process.env.SESSION_ACTOR_CACHE_TTL_MS = "0";

const pic = (n, company = 20) => ({ url: `https://res.cloudinary.com/demo/image/upload/p${n}.jpg`, publicId: `whyte/companies/${company}/products/p${n}` });

try {
  server = await startIsolatedServer("pimages", [
    { _id: 1, email: "owner@example.com", role: "company_owner", name: "Owner A", companyId: 20 },
    { _id: 2, email: "viewer@example.com", role: "configurable_admin", name: "Viewer", permissions: ["catalog:read"], companyId: 20 },
    { _id: 3, email: "ownerb@example.com", role: "company_owner", name: "Owner B", companyId: 30 },
  ], { production: true });
  const { db, login, api } = server;
  const now = new Date();
  await db.collection("companies").insertMany([
    { _id: 20, name: "Acme Homes", slug: "acme-homes", status: "active", phone: "+91 90000 11111", address: "Ahmedabad", gstNumber: null, email: "a@acme.example", logoUrl: null, tagline: null, createdAt: now, updatedAt: now },
    { _id: 30, name: "Beta Builders", slug: "beta-builders", status: "active", phone: "+91 90000 22222", address: "Surat", gstNumber: null, email: "b@beta.example", logoUrl: null, tagline: null, createdAt: now, updatedAt: now },
  ]);
  const cat = (id, companyId) => ({ _id: id, companyId, name: "Tactus", level: 1, parentId: null, sortOrder: id, isActive: true, variantTiers: [], variantFinishes: [], createdAt: now });
  await db.collection("categories").insertMany([cat(201, 20), cat(301, 30)]);
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const cookie = { a: await login("owner@example.com", "admin"), viewer: await login("viewer@example.com", "admin"), b: await login("ownerb@example.com", "admin") };

  const create = (body) => api(cookie.a, "POST", "/api/products", { name: "Switch", categoryId: 201, type: "switch_board", variants: [{ variantCode: `V${Math.random().toString(36).slice(2, 8).toUpperCase()}`, price: 1180 }], ...body });
  const stored = (id) => db.collection("products").findOne({ _id: id });

  // ═══ creating ═══
  const three = [pic(1), pic(2), { url: "/whyte_catalog_images/Tactus_item_001.jpg", publicId: null }];
  const made = await create({ name: "Gallery Switch", images: three });
  assert.equal(made.status, 201, made.text?.slice(0, 400));
  const productId = made.data.id;
  assert.deepEqual(made.data.images, three, "the answer lists the pictures in order");
  assert.deepEqual([made.data.imageUrl, made.data.imagePublicId], [three[0].url, three[0].publicId], "the single-image fields follow the cover");
  const row = await stored(productId);
  assert.deepEqual(row.images, three);
  assert.deepEqual([row.imageUrl, row.imagePublicId], [three[0].url, three[0].publicId]);
  pass("a product is created with up to six pictures, the first is the cover, and the older single-image fields follow it");

  const none = await create({ name: "Plain Switch" });
  assert.equal(none.status, 201);
  assert.deepEqual([none.data.images, none.data.imageUrl], [[], null], "no picture is fine");
  const six = await create({ name: "Six", images: [1, 2, 3, 4, 5, 6].map((n) => pic(n)) });
  assert.equal(six.status, 201, six.text?.slice(0, 300));
  assert.equal(six.data.images.length, 6);
  pass("no picture and exactly six pictures are both accepted");

  // ═══ refusals ═══
  const productsBefore = await db.collection("products").countDocuments();
  for (const [label, images, status, field] of [
    ["seven pictures", [1, 2, 3, 4, 5, 6, 7].map((n) => pic(n)), 400, undefined],
    ["the same picture twice", [pic(1), pic(1)], 400, undefined],
    ["a script address", [{ url: "javascript:alert(1)", publicId: null }], 400, undefined],
    ["an insecure address", [{ url: "http://insecure.example.com/a.jpg", publicId: null }], 400, undefined],
    ["a picture uploaded by another company", [pic(9, 30)], 403, "images"],
    ["a made-up asset outside the product folders", [{ url: "https://res.cloudinary.com/demo/image/upload/x.jpg", publicId: "somewhere/else/x" }], 403, "images"],
    ["a path trying to climb out", [{ url: "https://res.cloudinary.com/demo/image/upload/x.jpg", publicId: "whyte/companies/20/products/../../30/products/x" }], 403, "images"],
  ]) {
    const response = await create({ name: `Refused ${label}`, images });
    assert.equal(response.status, status, `${label}: ${response.text?.slice(0, 200)}`);
    if (field) assert.equal(response.json.error.field, field, label);
  }
  assert.equal(await db.collection("products").countDocuments(), productsBefore, "refused requests created nothing");
  pass("seven pictures, repeats, script or insecure addresses, another company's upload and malformed asset ids are all refused, and nothing is created");

  // ═══ editing ═══
  const patch = (cookieJar, id, body) => api(cookieJar, "PATCH", `/api/products/${id}`, body);
  const reordered = await patch(cookie.a, productId, { images: [three[2], three[0], three[1]] });
  assert.equal(reordered.status, 200, reordered.text?.slice(0, 300));
  assert.deepEqual(reordered.data.images.map((i) => i.url), [three[2].url, three[0].url, three[1].url]);
  assert.deepEqual([(await stored(productId)).imageUrl, (await stored(productId)).imagePublicId], [three[2].url, null], "making another picture the cover moves the single-image fields with it");

  const added = await patch(cookie.a, productId, { images: [...reordered.data.images, pic(4)] });
  assert.equal(added.data.images.length, 4);
  assert.equal((await patch(cookie.a, productId, { images: [...added.data.images, pic(5), pic(6), pic(7)] })).status, 400, "a seventh picture is refused on edit");
  assert.equal((await patch(cookie.a, productId, { images: [pic(8, 30)] })).status, 403, "so is another company's upload");
  assert.equal((await stored(productId)).images.length, 4, "refused edits changed nothing");

  const untouched = await patch(cookie.a, productId, { notes: "just a note" });
  assert.equal(untouched.status, 200);
  assert.equal((await stored(productId)).images.length, 4, "editing something else leaves the pictures alone");

  // an older client that still sends only the single image moves the cover, not the whole gallery
  const legacyClient = await patch(cookie.a, productId, { imageUrl: "https://res.cloudinary.com/demo/image/upload/legacy.jpg", imagePublicId: "whyte/companies/20/products/legacy" });
  assert.equal(legacyClient.status, 200, legacyClient.text?.slice(0, 300));
  const afterLegacy = (await stored(productId)).images.map((i) => i.url);
  assert.equal(afterLegacy[0], "https://res.cloudinary.com/demo/image/upload/legacy.jpg");
  assert.equal(afterLegacy.length, 4, "the other pictures stay");
  assert.equal((await patch(cookie.a, productId, { imageUrl: "https://res.cloudinary.com/demo/image/upload/x.jpg", imagePublicId: "whyte/companies/30/products/x" })).status, 403, "an older client cannot adopt another company's upload either");

  const cleared = await patch(cookie.a, productId, { images: [] });
  assert.equal(cleared.status, 200);
  assert.deepEqual([cleared.data.images, cleared.data.imageUrl, cleared.data.imagePublicId], [[], null, null], "an empty list clears every picture and the single-image fields");
  pass("editing: reorder / make cover / add / clear work, the cap and ownership rules hold, other edits leave pictures alone, and an older single-image client moves only the cover");

  // ═══ a product saved before galleries existed ═══
  await db.collection("products").insertOne({ _id: 9001, companyId: 20, name: "Old Switch", code: "OLD-1", type: "switch_board", categoryId: 201, unit: "pcs", imageUrl: "/whyte_catalog_images/old.jpg", imagePublicId: null, isActive: true, sortOrder: 1, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now });
  await db.collection("productvariants").insertOne({ _id: 9001, companyId: 20, productId: 9001, variantCode: "OLD-V1", config: {}, price: Decimal128.fromString("500.00"), isActive: true, sortOrder: 1, createdAt: now, updatedAt: now });
  const old = await api(cookie.a, "GET", "/api/products/9001");
  assert.equal(old.status, 200, old.text?.slice(0, 300));
  assert.deepEqual(old.data.images, [{ url: "/whyte_catalog_images/old.jpg", publicId: null }], "its single image reads as a one-picture gallery");
  assert.equal(old.data.imageUrl, "/whyte_catalog_images/old.jpg");
  assert.equal((await stored(9001)).images, undefined, "and nothing was migrated or rewritten by reading it");
  const grown = await patch(cookie.a, 9001, { images: [...old.data.images, pic(11)] });
  assert.equal(grown.status, 200);
  assert.deepEqual(grown.data.images.map((i) => i.url), ["/whyte_catalog_images/old.jpg", pic(11).url]);
  pass("a product saved before galleries existed shows its image as the first picture without any migration, and can grow into a gallery");

  // ═══ company isolation and permissions ═══
  assert.equal((await patch(cookie.b, 9001, { images: [pic(12, 30)] })).status, 404, "another company cannot touch the product");
  assert.equal((await patch(cookie.viewer, 9001, { images: [pic(13)] })).status, 403, "a role without catalog:edit cannot change pictures");
  assert.equal((await api(cookie.viewer, "POST", "/api/products", { name: "x", categoryId: 201, images: [pic(14)], variants: [{ variantCode: "ZZ", price: 1 }] })).status, 403);
  assert.equal((await stored(9001)).images.length, 2, "nothing changed");
  pass("another company cannot change a product's pictures, and neither can a role without catalog:edit");

  // ═══ variant pictures ═══
  await db.collection("productvariants").updateOne({ _id: 9001 }, { $set: { automationTier: "wifi", surfaceFinish: "black_glass" } });
  const variantPatch = (id, body) => api(cookie.a, "PATCH", `/api/product-variants/${id}`, body);
  const withPicture = await variantPatch(9001, { imageUrl: pic(20).url, imagePublicId: pic(20).publicId });
  assert.equal(withPicture.status, 200, withPicture.text?.slice(0, 300));
  assert.deepEqual([withPicture.data.imageUrl, withPicture.data.imagePublicId], [pic(20).url, pic(20).publicId]);
  const variantRow = await db.collection("productvariants").findOne({ _id: 9001 });
  assert.deepEqual([variantRow.automationTier, variantRow.surfaceFinish, String(variantRow.price)], ["wifi", "black_glass", "500.00"], "adding a picture does not erase the variant's tier, finish or price");
  assert.equal((await variantPatch(9001, { imageUrl: "https://res.cloudinary.com/demo/image/upload/x.jpg", imagePublicId: "whyte/companies/30/products/x" })).status, 403, "another company's upload is refused");
  assert.equal((await variantPatch(9001, { imageUrl: "javascript:alert(1)" })).status, 400);
  const external = await variantPatch(9001, { imageUrl: "https://example.com/finish.jpg" });
  assert.deepEqual([external.data.imageUrl, external.data.imagePublicId], ["https://example.com/finish.jpg", null], "an external picture has no asset id");
  const removed = await variantPatch(9001, { imageUrl: null });
  assert.deepEqual([removed.data.imageUrl, removed.data.imagePublicId], [null, null], "removing the picture clears its asset id too");
  const product9001 = await api(cookie.a, "GET", "/api/products/9001");
  assert.equal(product9001.data.variants[0].imageUrl, null, "the product's own variants list carries the field");

  const bulk = await api(cookie.a, "PATCH", "/api/products/9001/variants", { variants: [{ id: 9001, variantCode: "OLD-V1", price: 500, priceWithoutTax: 423.73, taxPercent: 18, imageUrl: pic(21).url, imagePublicId: pic(21).publicId }] });
  assert.equal(bulk.status, 200, bulk.text?.slice(0, 300));
  assert.equal((await db.collection("productvariants").findOne({ _id: 9001 })).imageUrl, pic(21).url, "the Edit Variants save carries the picture");
  const bulkKeep = await api(cookie.a, "PATCH", "/api/products/9001/variants", { variants: [{ id: 9001, variantCode: "OLD-V1", price: 510, priceWithoutTax: 432.2, taxPercent: 18 }] });
  assert.equal(bulkKeep.status, 200);
  assert.equal((await db.collection("productvariants").findOne({ _id: 9001 })).imageUrl, pic(21).url, "a save that does not mention the picture leaves it alone");
  const bulkForeign = await api(cookie.a, "PATCH", "/api/products/9001/variants", { variants: [{ id: 9001, variantCode: "OLD-V1", price: 510, priceWithoutTax: 432.2, taxPercent: 18, imageUrl: pic(22, 30).url, imagePublicId: pic(22, 30).publicId }] });
  assert.equal(bulkForeign.status, 403);
  const bulkClear = await api(cookie.a, "PATCH", "/api/products/9001/variants", { variants: [{ id: 9001, variantCode: "OLD-V1", price: 510, priceWithoutTax: 432.2, taxPercent: 18, imageUrl: null }] });
  assert.equal(bulkClear.status, 200);
  const cleared2 = await db.collection("productvariants").findOne({ _id: 9001 });
  assert.deepEqual([cleared2.imageUrl, cleared2.imagePublicId], [null, null]);
  pass("a variant can have its own optional picture (single edit and Edit Variants save): ownership is enforced, removing clears it, an unmentioned picture is left alone, and tier, finish and price are never disturbed");

  console.log(`\nALL ${count} PRODUCT IMAGE API TESTS PASSED!`);
} catch (error) {
  console.error(error);
  if (server) console.error("---- server output (tail) ----\n" + server.getOutput().slice(-3000));
  exitCode = 1;
} finally {
  await server?.cleanup();
  process.exit(exitCode);
}
