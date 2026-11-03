/**
 * Product pictures: the gallery rules (up to six, cover first), how an older single-image product reads, which uploaded
 * pictures a save removes, and what the product / variant schemas accept.
 *   npx ts-node -P tsconfig.testrun.json -r tsconfig-paths/register tests/product-images.test.ts
 */
import assert from "node:assert/strict";
import { MAX_PRODUCT_IMAGES, coverFields, imagesOf, moveImage, removedPublicIds, variantImageUrl, withLegacyCover, type ProductImage } from "../src/lib/productImages";
import { createProductSchema, productImagesField, updateProductSchema, updateVariantSchema } from "../src/lib/validation/product";

let count = 0;
const pass = (name: string) => {
  count += 1;
  console.log(`  ✓ ${name}`);
};
const img = (n: number, uploaded = true): ProductImage => ({ url: `https://res.cloudinary.com/x/image/upload/p${n}.jpg`, publicId: uploaded ? `whyte/c1/products/p${n}` : null });

assert.equal(MAX_PRODUCT_IMAGES, 6);

// ── reading ──
assert.deepEqual(imagesOf({}), [], "no picture");
assert.deepEqual(imagesOf({ imageUrl: "  /whyte_catalog_images/a.jpg ", imagePublicId: null }), [{ url: "/whyte_catalog_images/a.jpg", publicId: null }], "a product with only the older single image has that as its one picture");
assert.deepEqual(imagesOf({ imageUrl: "https://x/y.jpg", imagePublicId: "pid" }), [{ url: "https://x/y.jpg", publicId: "pid" }]);
assert.deepEqual(imagesOf({ images: [img(1), img(2)], imageUrl: "https://stale/old.jpg" }), [img(1), img(2)], "the gallery wins over the older field");
assert.equal(imagesOf({ images: Array.from({ length: 9 }, (_, i) => img(i)) }).length, 6, "never more than six are shown");
assert.deepEqual(imagesOf({ images: [{ url: "" }, { url: "https://x/a.jpg" }] }).map((i) => i.url), ["https://x/a.jpg"], "blank entries are ignored");
assert.deepEqual(coverFields([img(1), img(2)]), { imageUrl: img(1).url, imagePublicId: img(1).publicId });
assert.deepEqual(coverFields([]), { imageUrl: null, imagePublicId: null });
pass("a gallery reads cover-first and capped at six; a product with only the older single image reads as a one-picture gallery");

// ── variants ──
assert.equal(variantImageUrl({ imageUrl: "https://x/v.jpg" }, { imageUrl: "https://x/p.jpg" }), "https://x/v.jpg", "a variant's own picture wins");
assert.equal(variantImageUrl({ imageUrl: null }, { images: [img(3)] }), img(3).url, "otherwise the product's cover");
assert.equal(variantImageUrl({}, {}), null);
pass("a variant shows its own picture, else the product's cover");

// ── what a save removes / reorders ──
assert.deepEqual(removedPublicIds([img(1), img(2), img(3)], [img(2)]), [img(1).publicId, img(3).publicId], "uploaded pictures that were dropped are deleted from storage");
assert.deepEqual(removedPublicIds([img(1, false), img(2)], [img(2)]), [], "a static or external picture has nothing to delete");
assert.deepEqual(removedPublicIds([img(1)], [img(1), img(2)]), [], "adding deletes nothing");
assert.deepEqual(removedPublicIds([img(1), img(2)], [img(2), img(1)]), [], "reordering deletes nothing");
assert.deepEqual(moveImage([img(1), img(2), img(3)], 2, 0).map((i) => i.publicId), [img(3), img(1), img(2)].map((i) => i.publicId), "make cover");
assert.deepEqual(moveImage([img(1), img(2), img(3)], 0, 1).map((i) => i.publicId), [img(2), img(1), img(3)].map((i) => i.publicId));
assert.deepEqual(moveImage([img(1), img(2)], 5, 0), [img(1), img(2)], "an unknown position changes nothing");
assert.deepEqual(moveImage([img(1), img(2)], 0, 99).map((i) => i.url), [img(2).url, img(1).url], "clamped");
const legacy = withLegacyCover([img(1), img(2), img(3)], { imageUrl: "https://x/new.jpg", imagePublicId: "np" });
assert.deepEqual(legacy.map((i) => i.url), ["https://x/new.jpg", img(2).url, img(3).url], "an older client replacing the single image replaces the cover only");
assert.deepEqual(withLegacyCover([img(1), img(2)], { imageUrl: null, imagePublicId: null }).map((i) => i.url), [img(2).url], "removing the cover promotes the next picture");
assert.equal(withLegacyCover(Array.from({ length: 6 }, (_, i) => img(i)), { imageUrl: "https://x/n.jpg", imagePublicId: null }).length, 6);
pass("a save deletes only uploaded pictures that were dropped; reordering and cover changes delete nothing; an older single-image client moves only the cover");

// ── schemas ──
const ok = productImagesField.parse([{ url: "https://res.cloudinary.com/a.jpg", publicId: "pid" }, { url: "/whyte_catalog_images/b.jpg" }]);
assert.deepEqual(ok, [{ url: "https://res.cloudinary.com/a.jpg", publicId: "pid" }, { url: "/whyte_catalog_images/b.jpg", publicId: null }]);
assert.deepEqual(productImagesField.parse([]), []);
assert.equal(productImagesField.parse(undefined), undefined);
assert.equal(productImagesField.safeParse(Array.from({ length: 7 }, (_, i) => img(i))).success, false, "seven pictures are refused");
assert.equal(productImagesField.safeParse(Array.from({ length: 6 }, (_, i) => img(i))).success, true);
for (const bad of ["javascript:alert(1)", "http://insecure.example.com/a.jpg", "//evil.example.com/a.jpg", "data:image/png;base64,AAA", "ftp://x/a.jpg", "a b.jpg", "relative/path.jpg", ""]) {
  assert.equal(productImagesField.safeParse([{ url: bad }]).success, false, `refused: ${bad}`);
}
assert.equal(productImagesField.safeParse([{ url: "https://x/a.jpg" }, { url: "https://x/a.jpg" }]).success, false, "the same picture twice is refused");
assert.equal(productImagesField.safeParse([{ url: "https://x/a.jpg", extra: 1 }]).success, false, "unknown keys refused");
const base = { name: "Switch", categoryId: 1, variants: [{ variantCode: "A1", price: 100 }] };
assert.equal(createProductSchema.safeParse({ ...base, images: [img(1)] }).success, true);
assert.equal(createProductSchema.safeParse({ ...base, images: Array.from({ length: 7 }, (_, i) => img(i)) }).success, false);
assert.equal(updateProductSchema.safeParse({ images: [] }).success, true, "an empty list clears the pictures");
assert.equal(updateProductSchema.safeParse({ images: null }).success, false);
const withPicture = updateVariantSchema.parse({ imageUrl: "https://x/v.jpg", imagePublicId: "vp" });
assert.deepEqual([withPicture.imageUrl, withPicture.imagePublicId], ["https://x/v.jpg", "vp"]);
assert.equal(updateVariantSchema.parse({ imageUrl: null }).imageUrl, null);
assert.equal(updateVariantSchema.safeParse({ imageUrl: "javascript:x" }).success, false);
pass("schemas accept up to six https or static-path pictures, refuse seven, duplicates, scripts, insecure or relative links and unknown keys; variants accept one picture or null");

console.log(`\nALL ${count} PRODUCT IMAGE TESTS PASSED!`);
