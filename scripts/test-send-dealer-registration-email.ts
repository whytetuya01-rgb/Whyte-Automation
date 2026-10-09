/**
 * One-off manual verification: sends BOTH real dealer-registration emails
 * (the dealer welcome email and the super-admin credentials notice) via
 * Resend, using the exact same service/templates the live registration
 * route uses — without touching MongoDB or creating any dealer. Restricted
 * to a single hard-coded recipient on purpose.
 *
 *   npx tsx scripts/test-send-dealer-registration-email.ts
 */
import "dotenv/config";
import { sendEmail } from "../src/lib/email/service";
import { renderDealerRegistrationSuccessEmail } from "../src/lib/email/templates/dealer-registration-success";
import { renderDealerRegistrationAdminNoticeEmail } from "../src/lib/email/templates/dealer-registration-admin-notice";

const TEST_RECIPIENT = "whyte.tuya01@gmail.com";

async function send(label: string, subject: string, html: string, text: string) {
  console.log(`Sending ${label} to ${TEST_RECIPIENT} via Resend...`);
  const result = await sendEmail({ to: TEST_RECIPIENT, subject, html, text });
  if (result.sent) {
    console.log(`  SUCCESS: id=${result.id ?? "(not returned)"}`);
  } else {
    console.log(`  FAILED: reason=${result.reason}`);
  }
}

async function main() {
  const registrationDate = new Date().toLocaleDateString("en-IN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const dealerEmail = renderDealerRegistrationSuccessEmail({
    firstName: "Whyte",
    dealerName: "Whyte Test Dealer",
    dealerId: "TEST-001",
    email: TEST_RECIPIENT,
    phone: "+91 9999999999",
    companyName: null,
    registrationDate,
    loginUrl: "http://localhost:3000/login",
    supportEmail: "support@whyte.co.in",
  });
  await send("dealer welcome email", dealerEmail.subject, dealerEmail.html, dealerEmail.text);

  const adminNotice = renderDealerRegistrationAdminNoticeEmail({
    dealerId: "TEST-001",
    dealerName: "Whyte Test Dealer",
    username: TEST_RECIPIENT,
    password: "TestPassword123!", // placeholder only — not a real account's password
    contactNumber: "+91 9999999999",
    registrationDate,
    adminPanelUrl: "http://localhost:3000/admin/dealers",
  });
  await send("super admin credentials notice", adminNotice.subject, adminNotice.html, adminNotice.text);
}

main().catch((error) => {
  console.error("Unexpected error while running the test send:", error);
  process.exitCode = 1;
});
