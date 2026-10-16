import assert from "node:assert/strict";
import {
  extractNationalDigits,
  formatDisplayDigits,
} from "../src/components/ui/IndiaPhoneInput.tsx";

console.log("--- Comprehensive Tests for IndiaPhoneInput ---");

// Test 1: extractNationalDigits properly strips +91 country code prefix without duplicating 91
{
  assert.equal(extractNationalDigits("+91 9"), "9", 'Typing "9" must extract "9", NOT "919"');
  assert.equal(extractNationalDigits("+91 98"), "98");
  assert.equal(extractNationalDigits("+91 987"), "987");
  assert.equal(extractNationalDigits("+91 9876"), "9876");
  assert.equal(extractNationalDigits("+91 98765"), "98765");
  assert.equal(extractNationalDigits("+91 98765 4"), "987654");
  assert.equal(extractNationalDigits("+91 98765 43210"), "9876543210");
  assert.equal(extractNationalDigits("+91"), "");
  assert.equal(extractNationalDigits(""), "");
  console.log("  ✓ extractNationalDigits extracts single/partial digits without injecting 91");
}

// Test 2: Simulating typing keystroke-by-keystroke from empty to 10 digits
{
  const targetNumber = "9876543210";
  let parentValue = "";

  for (let i = 1; i <= targetNumber.length; i++) {
    const typedNationalDigits = targetNumber.slice(0, i);
    // Component formats and emits onChange:
    const formatted = `+91 ${formatDisplayDigits(typedNationalDigits)}`;
    parentValue = formatted;

    // Component receives updated parentValue via prop and runs extractNationalDigits:
    const extracted = extractNationalDigits(parentValue);
    assert.equal(
      extracted,
      typedNationalDigits,
      `Step ${i}: Typing "${typedNationalDigits}" must preserve exact digits, got "${extracted}"`
    );
  }
  console.log("  ✓ Typing keystroke-by-keystroke (1 to 10 digits) maintains exact national digits without corruption");
}

// Test 3: Simulating Backspace keystroke-by-keystroke from 10 digits down to empty
{
  const fullNumber = "9876543210";
  let parentValue = `+91 ${formatDisplayDigits(fullNumber)}`;

  for (let i = fullNumber.length - 1; i >= 0; i--) {
    const remainingDigits = fullNumber.slice(0, i);
    parentValue = remainingDigits ? `+91 ${formatDisplayDigits(remainingDigits)}` : "";

    const extracted = extractNationalDigits(parentValue);
    assert.equal(
      extracted,
      remainingDigits,
      `Backspace step ${i}: Backspacing to "${remainingDigits}" must extract "${remainingDigits}", got "${extracted}"`
    );
  }
  console.log("  ✓ Backspacing keystroke-by-keystroke down to empty never traps the user or prepends 91");
}

// Test 4: Handling mobile numbers that legitimately start with "91" (e.g. Jio/Airtel 91xxxx series)
{
  const jioNumber = "9123456789";
  assert.equal(extractNationalDigits(jioNumber), "9123456789");
  assert.equal(extractNationalDigits(`+91 ${formatDisplayDigits(jioNumber)}`), "9123456789");
  assert.equal(extractNationalDigits("+91 91"), "91");
  assert.equal(extractNationalDigits("+91 912"), "912");
  console.log("  ✓ Numbers legitimately starting with 91 are preserved accurately");
}

// Test 5: Pasting different international formats
{
  // Full international format with spaces
  assert.equal(extractNationalDigits("+91 98765 43210"), "9876543210");
  // Compact international format
  assert.equal(extractNationalDigits("+919876543210"), "9876543210");
  // 12 digits starting with 91 without plus
  assert.equal(extractNationalDigits("919876543210"), "9876543210");
  // 11 digits starting with trunk 0
  assert.equal(extractNationalDigits("09876543210"), "9876543210");
  // Plain 10 digits
  assert.equal(extractNationalDigits("9876543210"), "9876543210");
  console.log("  ✓ All pasted formats (with +91, with 91, with 0, or raw 10 digits) resolve cleanly to 10 national digits");
}

// Test 6: Display formatting: 5 digits then space then 5 digits
{
  assert.equal(formatDisplayDigits(""), "");
  assert.equal(formatDisplayDigits("9"), "9");
  assert.equal(formatDisplayDigits("98765"), "98765");
  assert.equal(formatDisplayDigits("987654"), "98765 4");
  assert.equal(formatDisplayDigits("9876543210"), "98765 43210");
  console.log("  ✓ formatDisplayDigits formats cleanly with Indian standard 5+5 mobile grouping");
}

console.log("\nALL INDIA PHONE INPUT TESTS PASSED SUCCESSFULLY!");
