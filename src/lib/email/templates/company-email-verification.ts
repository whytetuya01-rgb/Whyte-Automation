// "Verify your email" message sent to a company owner right after self-registration. Same visual language as the
// decision emails. It only contains the verification link: no password, no ids.

export interface CompanyVerificationEmailData {
  ownerFirstName: string;
  companyName: string;
  verifyUrl: string;
  expiresInHours: number;
  supportEmail: string;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderCompanyVerificationEmail(data: CompanyVerificationEmailData): { subject: string; html: string; text: string } {
  const subject = "Verify your email to complete your company registration";
  const name = escapeHtml(data.ownerFirstName);
  const company = escapeHtml(data.companyName);
  const url = escapeHtml(data.verifyUrl);
  const support = escapeHtml(data.supportEmail);
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f2f3;font-family:Arial,Helvetica,sans-serif;color:#1a181b;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f2f3;padding:28px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e7e2e4;">
      <tr><td style="background:#0e0d0f;padding:26px 32px;">
        <span style="font-size:26px;letter-spacing:6px;font-weight:300;color:#ffffff;">WHYTE</span><span style="color:#d46a8c;font-size:26px;">&bull;</span>
      </td></tr>
      <tr><td style="padding:36px 32px 12px 32px;">
        <h1 style="margin:0 0 16px 0;font-size:22px;color:#1a181b;">Verify your email address</h1>
        <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;">Hi ${name},</p>
        <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;">Thank you for registering <strong>${company}</strong>. Please confirm this is your email address. Your registration is reviewed once it is verified.</p>
        <p style="margin:24px 0;"><a href="${url}" style="display:inline-block;background:#0e0d0f;color:#ffffff;text-decoration:none;padding:13px 26px;border-radius:10px;font-weight:bold;font-size:15px;">Verify Email Address</a></p>
        <p style="margin:0 0 14px 0;font-size:13px;line-height:1.6;color:#5b5559;">This link expires in ${data.expiresInHours} hours. If the button does not work, open this address:<br><a href="${url}" style="color:#b84a6c;word-break:break-all;">${url}</a></p>
        <p style="margin:0 0 14px 0;font-size:13px;line-height:1.6;color:#5b5559;">If you did not register a company, you can ignore this email.</p>
      </td></tr>
      <tr><td style="padding:8px 32px 30px 32px;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#8b8589;border-top:1px solid #eee9eb;padding-top:18px;">
          Questions? Write to <a href="mailto:${support}" style="color:#b84a6c;">${support}</a>.
          This message was sent because a company registration was submitted with this email address.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
  const text = `Hi ${data.ownerFirstName},

Thank you for registering ${data.companyName}. Please confirm this is your email address by opening this link:

${data.verifyUrl}

Your registration is reviewed once it is verified. The link expires in ${data.expiresInHours} hours.
If you did not register a company, you can ignore this email.

Questions? Write to ${data.supportEmail}.
`;
  return { subject, html, text };
}
