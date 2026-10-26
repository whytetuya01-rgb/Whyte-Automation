// Company registration decision emails (approved / not approved).
//
// Same visual language as the dealer registration email (dark WHYTE masthead, pink accent). Deliberately plain
// content: no password, no internal review notes, no ids. The login link is built by the caller from configuration.

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface CompanyDecisionEmailData {
  ownerFirstName: string;
  companyName: string;
  loginUrl: string;
  supportEmail: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shell(title: string, bodyHtml: string, supportEmail: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f2f3;font-family:Arial,Helvetica,sans-serif;color:#1a181b;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f2f3;padding:28px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e7e2e4;">
      <tr><td style="background:#0e0d0f;padding:26px 32px;">
        <span style="font-size:26px;letter-spacing:6px;font-weight:300;color:#ffffff;">WHYTE</span><span style="color:#d46a8c;font-size:26px;">&bull;</span>
      </td></tr>
      <tr><td style="padding:36px 32px 12px 32px;">
        ${bodyHtml}
      </td></tr>
      <tr><td style="padding:8px 32px 30px 32px;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#8b8589;border-top:1px solid #eee9eb;padding-top:18px;">
          Questions? Write to <a href="mailto:${escapeHtml(supportEmail)}" style="color:#b84a6c;">${escapeHtml(supportEmail)}</a>.
          This message was sent because a company registration was submitted with this email address.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

export function renderCompanyApprovedEmail(data: CompanyDecisionEmailData): RenderedEmail {
  const subject = "Congratulations! Your Company Is Approved";
  const name = escapeHtml(data.ownerFirstName);
  const company = escapeHtml(data.companyName);
  const url = escapeHtml(data.loginUrl);
  const html = shell(
    subject,
    `<p style="margin:0 0 6px 0;font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#b84a6c;font-weight:bold;">Registration approved</p>
        <h1 style="margin:0 0 18px 0;font-size:26px;line-height:1.25;color:#0e0d0f;">Congratulations, ${name}!</h1>
        <p style="margin:0 0 14px 0;font-size:15px;line-height:1.65;color:#3a373b;">
          Your company registration for <strong>${company}</strong> has been approved. Your account is ready to use.
        </p>
        <p style="margin:0 0 26px 0;font-size:15px;line-height:1.65;color:#3a373b;">
          Sign in with the email address and password you supplied during registration.
        </p>
        <p style="margin:0 0 8px 0;">
          <a href="${url}" style="display:inline-block;background:#0e0d0f;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:14px 28px;border-radius:10px;">Login to Your Account</a>
        </p>
        <p style="margin:18px 0 0 0;font-size:12px;line-height:1.6;color:#8b8589;">
          If the button does not work, copy this link into your browser:<br>
          <a href="${url}" style="color:#b84a6c;word-break:break-all;">${url}</a>
        </p>`,
    data.supportEmail
  );
  const text = [
    `Congratulations, ${data.ownerFirstName}!`,
    "",
    `Your company registration for ${data.companyName} has been approved. Your account is ready to use.`,
    "Sign in with the email address and password you supplied during registration.",
    "",
    `Login to Your Account: ${data.loginUrl}`,
    "",
    `Questions? ${data.supportEmail}`,
  ].join("\n");
  return { subject, html, text };
}

export function renderCompanyRejectedEmail(data: CompanyDecisionEmailData): RenderedEmail {
  const subject = "Update on Your Whyte Automation Company Registration";
  const name = escapeHtml(data.ownerFirstName);
  const company = escapeHtml(data.companyName);
  const support = escapeHtml(data.supportEmail);
  const html = shell(
    subject,
    `<p style="margin:0 0 6px 0;font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#b84a6c;font-weight:bold;">Registration update</p>
        <h1 style="margin:0 0 18px 0;font-size:24px;line-height:1.25;color:#0e0d0f;">Hello ${name},</h1>
        <p style="margin:0 0 14px 0;font-size:15px;line-height:1.65;color:#3a373b;">
          Thank you for your interest in Whyte Automation. After review, we are unable to approve the registration for
          <strong>${company}</strong> at this time.
        </p>
        <p style="margin:0;font-size:15px;line-height:1.65;color:#3a373b;">
          If you believe this is a mistake, or would like to discuss it, please contact us at
          <a href="mailto:${support}" style="color:#b84a6c;">${support}</a>.
        </p>`,
    data.supportEmail
  );
  const text = [
    `Hello ${data.ownerFirstName},`,
    "",
    `Thank you for your interest in Whyte Automation. After review, we are unable to approve the registration for ${data.companyName} at this time.`,
    `If you believe this is a mistake, please contact us at ${data.supportEmail}.`,
  ].join("\n");
  return { subject, html, text };
}
