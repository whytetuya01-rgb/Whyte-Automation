import assert from "node:assert/strict";
import {
  isValidEmail,
  isValidGstin,
  isValidIndianMobile,
  isValidPhone,
  normalizeIndianMobile,
  formatIndianMobile,
  emailSchema,
  mobileSchema,
  optionalGstinSchema,
  optionalPhoneSchema,
  optionalEmailSchema,
  phoneSchema,
} from "../src/lib/validation/fields.ts";

/** Unit tests for the shared email / phone / GSTIN validators (no server needed). */
let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures++;
    console.log(`FAIL ${name}: ${error.message}`);
  }
}

check("email: valid addresses", () => {
  for (const e of ["name@company.com", "first.last+tag@sub.domain.co.in", "a@b.io", "USER@Example.COM", "o'brien@corp.in"]) {
    assert.equal(isValidEmail(e), true, e);
  }
});
check("email: invalid addresses", () => {
  for (const e of ["", "plain", "a@b", "a@b.", "@b.com", "a@@b.com", "a b@c.com", "a..b@c.com", ".a@c.com", "a.@c.com", "a@-b.com", "a@b-.com", "a@b.c", "a@b.c0m", "a@b..com", "x".repeat(65) + "@a.com", "a@" + "x".repeat(250) + ".com"]) {
    assert.equal(isValidEmail(e), false, JSON.stringify(e));
  }
  assert.equal(isValidEmail(null), false);
  assert.equal(isValidEmail(undefined), false);
});
check("email schema trims and lowercases; rejects junk", () => {
  assert.equal(emailSchema.parse("  Name@Company.COM "), "name@company.com");
  assert.equal(emailSchema.safeParse("nope").success, false);
  assert.equal(optionalEmailSchema.parse(undefined), undefined);
  assert.equal(optionalEmailSchema.parse("  "), null);
  assert.equal(optionalEmailSchema.parse(null), null);
  assert.equal(optionalEmailSchema.safeParse("bad@").success, false);
});

check("indian mobile: valid formats normalise to 10 digits", () => {
  for (const v of ["9876543210", "98765 43210", "+91 98765 43210", "+919876543210", "919876543210", "09876543210", "(98765) 43210", "98765-43210", "6000000000"]) {
    assert.equal(normalizeIndianMobile(v), v.replace(/\D/g, "").slice(-10), v);
  }
  assert.equal(formatIndianMobile("9876543210"), "+91 98765 43210");
});
check("indian mobile: invalid numbers", () => {
  for (const v of ["", "12345", "5876543210", "0123456789", "98765432101", "+1 9876543210", "98765 4321a", "9876 543 21", "++919876543210", "98+7654321", "abcdefghij", "+91 12345 67890"]) {
    assert.equal(isValidIndianMobile(v), false, JSON.stringify(v));
  }
  assert.equal(isValidIndianMobile(null), false);
});
check("mobile schema stores canonical format", () => {
  assert.equal(mobileSchema.parse("9876543210"), "+91 98765 43210");
  assert.equal(mobileSchema.safeParse("1234").success, false);
  assert.equal(mobileSchema.safeParse("").success, false);
});

check("general phone: accepts landline / international, rejects letters and bad lengths", () => {
  for (const v of ["079 2630 1234", "+44 20 7946 0958", "(022) 2345-6789", "9876543210", "1234567"]) assert.equal(isValidPhone(v), true, v);
  for (const v of ["", "123456", "1".repeat(16), "phone", "98765x43210", "12+34567890", "---"]) assert.equal(isValidPhone(v), false, JSON.stringify(v));
  assert.equal(phoneSchema.safeParse("abc").success, false);
  assert.equal(optionalPhoneSchema.parse(""), null);
  assert.equal(optionalPhoneSchema.parse(undefined), undefined);
  assert.equal(optionalPhoneSchema.safeParse("12").success, false);
});

check("GSTIN: real, checksum-correct numbers are accepted (any case, spaces trimmed)", () => {
  for (const g of ["27AAPFU0939F1ZV", "24AAACC1206D1ZM"]) {
    // Build the expected check char with the validator itself to document the intent:
    assert.equal(isValidGstin(g), true, g);
  }
  assert.equal(isValidGstin(" 27aapfu0939f1zv "), true);
});
check("GSTIN: structural and checksum errors are rejected", () => {
  for (const g of [
    "", "27AAPFU0939F1Z", "27AAPFU0939F1ZVV", "27AAPFU0939F1ZX", // wrong check digit
    "00AAPFU0939F1ZV", "39AAPFU0939F1ZV", "27AAPFU0939F1AV", // state 00/39, missing Z
    "27AAPF10939F1ZV", "27AAPFUA939F1ZV", // PAN structure broken
    "27AAPFU0939F0ZV", // entity code 0
    "ABCDEFGHIJKLMNO", "27-AAPFU0939F1ZV",
  ]) {
    assert.equal(isValidGstin(g), false, JSON.stringify(g));
  }
  assert.equal(isValidGstin(null), false);
});
check("GSTIN schema: optional, upper-cased, blank -> null, invalid rejected", () => {
  assert.equal(optionalGstinSchema.parse(undefined), undefined);
  assert.equal(optionalGstinSchema.parse(""), null);
  assert.equal(optionalGstinSchema.parse(null), null);
  assert.equal(optionalGstinSchema.parse("27aapfu0939f1zv"), "27AAPFU0939F1ZV");
  assert.equal(optionalGstinSchema.safeParse("27AAPFU0939F1ZX").success, false);
});

console.log(failures === 0 ? "\nAll field validation tests passed." : `\n${failures} field validation test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
