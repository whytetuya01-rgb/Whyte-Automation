/**
 * Product pictures end to end (real Chromium, isolated production server, throwaway MongoDB). Uploads go to a stand-in for
 * the image service (the page's /api/upload calls are answered locally and recorded), so nothing reaches Cloudinary.
 *
 *   PLAYWRIGHT_MODULE=<path>/node_modules/playwright node tests/product-images.browser.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { startIsolatedServer, Decimal128 } from "./helpers/isolatedServer.mjs";

const modulePath = process.env.PLAYWRIGHT_MODULE;
if (!modulePath) {
  console.error("UNVERIFIED: set PLAYWRIGHT_MODULE to a playwright package directory to run the browser check.");
  process.exit(2);
}
const { chromium } = createRequire(import.meta.url)(modulePath);

let count = 0;
const pass = (name) => { count += 1; console.log(`  ✓ ${name}`); };
let server;
let browser;
let exitCode = 0;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const own = (name) => ({ url: `https://res.cloudinary.com/demo/image/upload/${name}.jpg`, publicId: `whyte/companies/20/products/${name}` });
const waitUntil = async (check, what, ms = 15000) => {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
};

try {
  server = await startIsolatedServer("pimages-ui", [
    { _id: 1, email: "ownera@example.com", role: "company_owner", name: "Owner A", companyId: 20 },
  ], { production: true });
  const { db, login, baseUrl } = server;
  const now = new Date();
  await db.collection("companies").insertOne({ _id: 20, name: "Acme Homes", slug: "acme-homes", status: "active", phone: "+91 90000 11111", address: "Ahmedabad", gstNumber: null, email: "a@acme.example", logoUrl: null, tagline: null, createdAt: now, updatedAt: now });
  await db.collection("categories").insertOne({ _id: 201, companyId: 20, name: "Tactus", level: 1, parentId: null, sortOrder: 1, isActive: true, variantTiers: [], variantFinishes: [], createdAt: now });
  await db.collection("products").insertOne({ _id: 2001, companyId: 20, name: "Smart Switch", code: "P-2001", type: "switch_board", categoryId: 201, unit: "pcs", isActive: true, sortOrder: 1, isMatrix: false, matrixDimensions: null, createdAt: now, updatedAt: now });
  await db.collection("productvariants").insertOne({ _id: 2001, companyId: 20, productId: 2001, variantCode: "V-2001", config: {}, price: Decimal128.fromString("1000.00"), priceWithoutTax: Decimal128.fromString("847.46"), taxPercent: Decimal128.fromString("18.00"), isActive: true, sortOrder: 1, createdAt: now, updatedAt: now });
  await db.collection("counters").insertOne({ _id: "adminUser", seq: 100 });
  const cookie = await login("ownera@example.com", "admin");

  browser = await chromium.launch({ headless: true });
  let uploadSeq = 0;
  const deletes = [];
  const open = async (viewport) => {
    const context = await browser.newContext({ viewport });
    await context.addCookies(cookie.split("; ").filter(Boolean).map((pair) => { const i = pair.indexOf("="); return { name: pair.slice(0, i), value: pair.slice(i + 1), url: baseUrl }; }));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    // The image service: uploads are answered with a new asset in this company's folder, deletes are recorded.
    await page.route("**/api/upload", async (route) => {
      const request = route.request();
      if (request.method() === "POST") {
        const n = ++uploadSeq;
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { url: `https://res.cloudinary.com/demo/image/upload/up${n}.jpg`, publicId: `whyte/companies/20/products/up${n}` } }) });
      }
      if (request.method() === "DELETE") {
        deletes.push(JSON.parse(request.postData() ?? "{}").publicId);
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: { deleted: true } }) });
      }
      return route.continue();
    });
    // The pictures themselves are not reachable offline: answer with a tiny image so nothing is reported as broken.
    await page.route("https://res.cloudinary.com/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
    return page;
  };
  const noHorizontalScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const within = async (locator, width) => { const box = await locator.boundingBox(); return Boolean(box) && box.x >= -1 && box.x + box.width <= width + 1; };
  const shot = async (page, name) => { if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${name}.png`, fullPage: true }); };
  const file = (name) => ({ name, mimeType: "image/png", buffer: PNG });

  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 800 }]) {
    const w = viewport.width;
    const A = own(`a${w}`);
    const B = own(`b${w}`);
    await db.collection("products").updateOne({ _id: 2001 }, { $set: { images: [A, B], imageUrl: A.url, imagePublicId: A.publicId } });
    deletes.length = 0;

    const page = await open(viewport);
    await page.goto(`${baseUrl}/admin/products/2001`, { waitUntil: "load" });
    await page.getByTestId("product-gallery").waitFor();
    assert.equal(await page.getByTestId("product-gallery").locator("li").count(), 2, `the product page lists both pictures at ${w}px`);
    assert.ok(await noHorizontalScroll(page), `no horizontal scroll on the product page at ${w}px`);

    await page.getByRole("button", { name: "Edit Product" }).click();
    const editor = page.getByTestId("product-images-editor");
    await editor.waitFor();
    const tiles = editor.getByTestId("product-image-tile");
    assert.equal(await tiles.count(), 2);
    assert.match(await editor.getByTestId("product-images-count").innerText(), /2 of 6 images/);
    assert.equal(await tiles.nth(0).getByTestId("product-image-cover-badge").count(), 1, "the first picture is the cover");

    // upload three: they appear in order
    await editor.getByTestId("product-image-upload").setInputFiles([file("x1.png"), file("x2.png"), file("x3.png")]);
    await waitUntil(async () => (await tiles.count()) === 5, "three uploads to appear");
    assert.match(await editor.getByTestId("product-images-count").innerText(), /5 of 6 images/);
    const firstUpload = uploadSeq - 2;

    // two more files but only one place: the extra is skipped, then the editor is full
    await editor.getByTestId("product-image-upload").setInputFiles([file("y1.png"), file("y2.png")]);
    await waitUntil(async () => (await tiles.count()) === 6, "the sixth picture");
    assert.equal(uploadSeq, firstUpload + 3, "only one more file was uploaded: the sixth place was the last");
    assert.equal(await editor.getByTestId("product-image-upload").isDisabled(), true, "no more uploads once there are six");
    assert.equal(await editor.getByTestId("product-image-url").isDisabled(), true, "nor links");
    assert.ok(await noHorizontalScroll(page), `no horizontal scroll with six pictures at ${w}px`);
    for (let i = 0; i < 6; i += 1) assert.ok(await within(tiles.nth(i), w), `tile ${i + 1} is on screen at ${w}px`);
    await shot(page, `product-images-${w}`);

    // make the 4th picture the cover
    const fourthUrl = await tiles.nth(3).locator("img").getAttribute("src");
    await tiles.nth(3).getByRole("button", { name: "Make cover" }).click();
    assert.equal(await tiles.nth(0).locator("img").getAttribute("src"), fourthUrl, "it moved to the front");
    assert.equal(await tiles.nth(0).getByTestId("product-image-cover-badge").count(), 1);
    assert.equal(await editor.getByTestId("product-image-cover-badge").count(), 1, "exactly one cover");
    // move the new cover one place later and back
    await tiles.nth(0).getByRole("button", { name: /Move image 1 later/ }).click();
    assert.equal(await tiles.nth(1).locator("img").getAttribute("src"), fourthUrl);
    await tiles.nth(1).getByRole("button", { name: /Move image 2 earlier/ }).click();
    assert.equal(await tiles.nth(0).locator("img").getAttribute("src"), fourthUrl);

    // remove one unsaved upload (deleted from storage at once) and one saved picture (kept until the save)
    const lastTile = tiles.nth(5);
    const lastUploadId = `whyte/companies/20/products/up${uploadSeq}`;
    const lastUrl = await lastTile.locator("img").getAttribute("src");
    assert.equal(lastUrl, `https://res.cloudinary.com/demo/image/upload/up${uploadSeq}.jpg`);
    await lastTile.getByRole("button", { name: /Remove image 6/ }).click();
    await waitUntil(() => deletes.includes(lastUploadId), "the unsaved upload to be deleted from storage");
    assert.equal(await tiles.count(), 5);
    const savedTile = editor.locator(`[data-testid="product-image-tile"]:has(img[src="${A.url}"])`);
    await savedTile.getByRole("button", { name: /Remove image/ }).click();
    assert.equal(await tiles.count(), 4);
    assert.ok(!deletes.includes(A.publicId), "a saved picture is only deleted after the save succeeds");

    // links
    await editor.getByTestId("product-image-url").fill("javascript:alert(1)");
    await editor.getByTestId("product-image-add-link").click();
    await page.locator("text=Not a valid image address").first().waitFor();
    assert.equal(await tiles.count(), 4, "a script address is refused");
    await editor.getByTestId("product-image-url").fill(`/whyte_catalog_images/new-${w}.jpg`);
    await editor.getByTestId("product-image-add-link").click();
    assert.equal(await tiles.count(), 5);
    await editor.getByTestId("product-image-url").fill(`/whyte_catalog_images/new-${w}.jpg`);
    await editor.getByTestId("product-image-add-link").click();
    await page.locator("text=Already added").first().waitFor();
    assert.equal(await tiles.count(), 5, "the same picture twice is refused");

    const shown = await tiles.evaluateAll((nodes) => nodes.map((node) => node.querySelector("img").getAttribute("src")));
    await page.getByRole("button", { name: "Update Product" }).click();
    await page.locator("text=Product updated").first().waitFor();
    const saved = await db.collection("products").findOne({ _id: 2001 });
    assert.deepEqual(saved.images.map((i) => i.url), shown, "what the screen showed is what was saved, in that order");
    assert.deepEqual([saved.imageUrl, saved.imagePublicId], [saved.images[0].url, saved.images[0].publicId], "the single-image fields follow the cover");
    assert.equal(saved.images.length, 5);
    await waitUntil(() => deletes.includes(A.publicId), "the removed saved picture to be deleted from storage after the save");
    assert.ok(!deletes.includes(B.publicId), "pictures that were kept are not deleted");
    for (const keptUpload of saved.images.map((i) => i.publicId).filter(Boolean)) assert.ok(!deletes.includes(keptUpload), `${keptUpload} was kept`);
    await page.context().close();
  }
  pass("the product form: upload several pictures (stops at six), make cover, move, remove (unsaved ones leave storage at once, saved ones after the save), add links (bad and repeated ones refused); saved in the shown order; works at 1280px and 375px with no overflow");

  // closing the form without saving removes what was uploaded
  {
    const page = await open({ width: 1280, height: 900 });
    deletes.length = 0;
    await page.goto(`${baseUrl}/admin/products/2001`, { waitUntil: "load" });
    await page.getByRole("button", { name: "Edit Product" }).click();
    const editor = page.getByTestId("product-images-editor");
    await editor.waitFor();
    const before = (await db.collection("products").findOne({ _id: 2001 })).images.length;
    await editor.getByTestId("product-image-upload").setInputFiles([file("z.png")]);
    await waitUntil(async () => (await editor.getByTestId("product-image-tile").count()) === before + 1, "the upload");
    const abandoned = `whyte/companies/20/products/up${uploadSeq}`;
    await page.getByRole("button", { name: "Cancel" }).first().click();
    await waitUntil(() => deletes.includes(abandoned), "the abandoned upload to be deleted from storage");
    assert.equal((await db.collection("products").findOne({ _id: 2001 })).images.length, before, "and the product is unchanged");
    await page.context().close();
  }
  pass("cancelling the form deletes the pictures uploaded in it and changes nothing");

  // a product with only the older single image
  {
    await db.collection("products").updateOne({ _id: 2001 }, { $unset: { images: "" }, $set: { imageUrl: "/whyte_catalog_images/old.jpg", imagePublicId: null } });
    const page = await open({ width: 375, height: 800 });
    await page.goto(`${baseUrl}/admin/products/2001`, { waitUntil: "load" });
    await page.getByRole("button", { name: "Edit Product" }).click();
    const editor = page.getByTestId("product-images-editor");
    await editor.waitFor();
    const tiles = editor.getByTestId("product-image-tile");
    assert.equal(await tiles.count(), 1, "the older single image shows as the first picture");
    assert.equal(await tiles.nth(0).locator("img").getAttribute("src"), "/whyte_catalog_images/old.jpg");
    await editor.getByTestId("product-image-url").fill("/whyte_catalog_images/second.jpg");
    await editor.getByTestId("product-image-add-link").click();
    await page.getByRole("button", { name: "Update Product" }).click();
    await page.locator("text=Product updated").first().waitFor();
    const saved = await db.collection("products").findOne({ _id: 2001 });
    assert.deepEqual(saved.images.map((i) => i.url), ["/whyte_catalog_images/old.jpg", "/whyte_catalog_images/second.jpg"]);
    assert.equal(saved.imageUrl, "/whyte_catalog_images/old.jpg");
    await page.context().close();
  }
  pass("a product saved before galleries existed opens with its image as the first picture and grows into a gallery");

  // a variant's own picture, through Edit Variants
  for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 800 }]) {
    const w = viewport.width;
    await db.collection("productvariants").updateOne({ _id: 2001 }, { $set: { imageUrl: null, imagePublicId: null } });
    const page = await open(viewport);
    deletes.length = 0;
    await page.goto(`${baseUrl}/admin/products/2001`, { waitUntil: "load" });
    await page.getByRole("button", { name: /Edit Variants/ }).first().click();
    const control = page.getByTestId("variant-image-control").first();
    await control.waitFor();
    assert.equal(await control.getByTestId("variant-image-preview").count(), 1, "it shows the product's cover, faded, until the variant has its own");
    assert.equal(await control.getByTestId("variant-image-preview").getAttribute("data-own"), "false");
    await control.getByTestId("variant-image-upload").setInputFiles([file("v.png")]);
    await waitUntil(async () => (await control.getByTestId("variant-image-preview").getAttribute("data-own")) === "true", "the variant picture");
    const variantUpload = `whyte/companies/20/products/up${uploadSeq}`;
    await page.getByRole("button", { name: /Save Changes/ }).click();
    await page.locator("text=Variants updated").first().waitFor();
    const variant = await db.collection("productvariants").findOne({ _id: 2001 });
    assert.deepEqual([variant.imageUrl, variant.imagePublicId], [`https://res.cloudinary.com/demo/image/upload/up${uploadSeq}.jpg`, variantUpload], `the variant picture is saved at ${w}px`);
    assert.ok(!deletes.includes(variantUpload), "and kept");
    // remove it again
    await control.getByRole("button", { name: "Remove variant image" }).click();
    await page.getByRole("button", { name: /Save Changes/ }).click();
    await waitUntil(async () => (await db.collection("productvariants").findOne({ _id: 2001 })).imageUrl === null, "the picture to be removed");
    await waitUntil(() => deletes.includes(variantUpload), "the removed variant picture to leave storage");
    assert.ok(await noHorizontalScroll(page), `no horizontal scroll at ${w}px`);
    await page.context().close();
  }
  pass("Edit Variants: a variant can get its own picture and lose it again (saved with the variant, removed from storage after the save), at 1280px and 375px");

  console.log(`\nALL ${count} PRODUCT IMAGE BROWSER TESTS PASSED!`);
} catch (error) {
  console.error(error);
  if (server) console.error("---- server output (tail) ----\n" + server.getOutput().slice(-3000));
  exitCode = 1;
} finally {
  await browser?.close();
  await server?.cleanup();
  process.exit(exitCode);
}
