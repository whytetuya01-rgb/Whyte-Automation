/**
 * Authentication Rate Limiting & Brute-Force Protection Test Suite
 *
 * Verifies:
 * 1. Initial state allows login attempts
 * 2. Failed attempt increments failure counter
 * 3. 5 consecutive failures triggers account throttling
 * 4. Account throttle reports retryAfterSeconds
 * 5. Successful login resets failure counter for legitimate recovery
 * 6. IP throttle triggers after threshold across multiple accounts
 * 7. Constant-time dummy comparison runs when account does not exist
 * 8. Masking functions sanitize emails and IPs for security audit logs
 * 9. Header parsing extracts client IP correctly from proxy headers
 */

import assert from "node:assert/strict";
import {
  checkLoginRateLimit,
  recordFailedLoginAttempt,
  recordSuccessfulLogin,
  resetAuthRateLimitForTesting,
  constantTimeDummyCompare,
  maskEmail,
  maskIp,
  extractClientIpFromAuthRequest,
  MAX_ACCOUNT_FAILURES,
  MAX_IP_FAILURES,
} from "../src/lib/authRateLimit";

function pass(name: string) {
  console.log(`✓ ${name}`);
}

async function run() {
  console.log("\n--- Testing Whyte Authentication Security & Rate Limiting ---\n");

  await resetAuthRateLimitForTesting();

  const testEmail = "sales.executive@whyte.co.in";
  const testIp = "192.168.1.100";

  // 1. Initial state allows login attempts
  const initialCheck = await checkLoginRateLimit({ email: testEmail, ip: testIp });
  assert.equal(initialCheck.allowed, true, "Initial login check should be allowed");
  assert.equal(initialCheck.retryAfterSeconds, 0);
  pass("1. Initial login check permits legitimate attempts");

  // 2. Failed attempts increment counter up to threshold
  for (let i = 1; i <= MAX_ACCOUNT_FAILURES - 1; i++) {
    await recordFailedLoginAttempt({ email: testEmail, ip: testIp });
    const check = await checkLoginRateLimit({ email: testEmail, ip: testIp });
    assert.equal(check.allowed, true, `Attempt ${i} should still be allowed under threshold`);
  }
  pass(`2. Under-threshold failed attempts (${MAX_ACCOUNT_FAILURES - 1}) increment counter without blocking`);

  // 3. Reaching threshold triggers account throttle
  await recordFailedLoginAttempt({ email: testEmail, ip: testIp }); // 5th failure
  const throttledCheck = await checkLoginRateLimit({ email: testEmail, ip: testIp });
  assert.equal(throttledCheck.allowed, false, "5th failed attempt must trigger throttling");
  assert.equal(throttledCheck.reason, "ACCOUNT_THROTTLED");
  assert.ok(throttledCheck.retryAfterSeconds > 0, "retryAfterSeconds must be greater than zero");
  pass("3. Consecutive failed attempts trigger ACCOUNT_THROTTLED state");

  // 4. Different account from same IP is NOT blocked by account throttle
  const otherEmail = "other.dealer@whyte.co.in";
  const otherCheck = await checkLoginRateLimit({ email: otherEmail, ip: testIp });
  assert.equal(otherCheck.allowed, true, "Different account from same IP should not be blocked by account throttle");
  pass("4. Account throttling isolates only the attacked account");

  // 5. Successful login resets counter for legitimate recovery
  await recordSuccessfulLogin({ email: testEmail, ip: testIp });
  const postResetCheck = await checkLoginRateLimit({ email: testEmail, ip: testIp });
  assert.equal(postResetCheck.allowed, true, "Successful login must immediately reset failure counter");
  pass("5. Successful login clears failure strikes, allowing recovery for legitimate users");

  // 6. IP rate limiting triggers across distributed/multiple accounts
  await resetAuthRateLimitForTesting();
  const attackerIp = "198.51.100.42";
  for (let i = 1; i <= MAX_IP_FAILURES; i++) {
    const rotatedEmail = `victim_${i}@whyte.co.in`;
    await recordFailedLoginAttempt({ email: rotatedEmail, ip: attackerIp });
  }
  const ipCheck = await checkLoginRateLimit({ email: "fresh.target@whyte.co.in", ip: attackerIp });
  assert.equal(ipCheck.allowed, false, "Attacker IP rotating accounts must be throttled");
  assert.equal(ipCheck.reason, "IP_THROTTLED");
  assert.ok(ipCheck.retryAfterSeconds > 0);
  pass(`6. Credential-stuffing protection: IP-wide throttle triggers after ${MAX_IP_FAILURES} failures`);

  // 7. Constant-time dummy comparison runs when account does not exist
  const dummyStart = performance.now();
  const dummyResult = await constantTimeDummyCompare("password123");
  const dummyDuration = performance.now() - dummyStart;
  assert.equal(dummyResult, false, "Dummy compare must return false");
  assert.ok(dummyDuration >= 20, "Bcrypt dummy compare must execute real computational rounds");
  pass("7. Constant-time dummy comparison eliminates user enumeration timing side-channels");

  // 8. Masking functions protect PII in security audit logs
  assert.equal(maskEmail("admin@whyte.co.in"), "ad***@whyte.co.in");
  assert.equal(maskEmail("jo@test.com"), "j*@test.com");
  assert.equal(maskIp("192.168.1.55"), "192.168.***.***");
  assert.equal(maskIp("2001:db8:85a3::8a2e:370:7334"), "2001:db8:****");
  pass("8. PII masking functions sanitize emails and IPs for audit logging without secret leaks");

  // 9. IP extraction from NextAuth proxy headers
  const reqWithForwarded = {
    headers: {
      "x-forwarded-for": "203.0.113.195, 10.0.0.1",
      "x-real-ip": "10.0.0.1",
    },
  };
  assert.equal(extractClientIpFromAuthRequest(reqWithForwarded), "203.0.113.195");

  const reqWithRealIp = {
    headers: {
      "x-real-ip": "198.51.100.10",
    },
  };
  assert.equal(extractClientIpFromAuthRequest(reqWithRealIp), "198.51.100.10");
  pass("9. extractClientIpFromAuthRequest correctly extracts client IP from standard proxy headers");

  await resetAuthRateLimitForTesting();
  console.log("\nALL 9 AUTH RATE LIMIT & SECURITY TESTS PASSED!\n");
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

