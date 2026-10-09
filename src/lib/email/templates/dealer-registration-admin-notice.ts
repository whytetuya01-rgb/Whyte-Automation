// Internal notification sent to super admins whenever a new dealer
// registers, containing that dealer's login credentials (ID, username,
// password) so a super admin can see/share them if needed.
//
// SECURITY NOTE: this intentionally includes a plaintext password. That is
// a real risk if the recipient inbox is ever compromised — it exists only
// because it was explicitly requested for this internal admin-facing flow.
// It must never be sent to anyone other than a verified super_admin AdminUser
// record pulled from the database, and the password must never be logged
// anywhere outside this one-time email body.
//
// Same visual language as the dealer welcome email (dealer-registration-success.ts):
// same dark/pink premium palette and the same WHYTE wordmark markup
// (styled text + pink bullet — not an image in the source reference).

export interface DealerRegistrationAdminNoticeData {
  dealerId: string;
  dealerName: string;
  username: string;
  password: string;
  contactNumber: string | null;
  registrationDate: string;
  adminPanelUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function detailCell(label: string, value: string | null, borderLeft: boolean, emphasize = false): string {
  if (!value) return "";
  const border = borderLeft ? "border-left:1px solid #2A272B;" : "";
  const valueColor = emphasize ? "#E8457A" : "#F4F1EE";
  return `
        <td class="stack" width="50%" valign="top" style="padding:22px 0 22px ${borderLeft ? "24px" : "0"};${border}">
          <div class="sans" style="font-family:'Jost',Arial,sans-serif;font-size:9px;letter-spacing:3px;color:#7D7880;text-transform:uppercase;">${label}</div>
          <div class="serif" style="font-family:'Cormorant Garamond',Georgia,serif;font-size:22px;color:${valueColor};margin-top:6px;">${escapeHtml(value)}</div>
        </td>`;
}

export function renderDealerRegistrationAdminNoticeEmail(data: DealerRegistrationAdminNoticeData): RenderedEmail {
  const fields: Array<[string, string | null, boolean?]> = [
    ["Dealer ID", data.dealerId],
    ["Registered On", data.registrationDate],
    ["Dealer Name", data.dealerName],
    ["Phone", data.contactNumber],
    ["Username (Email)", data.username],
    ["Password", data.password, true],
  ];

  const rows: string[] = [];
  for (let i = 0; i < fields.length; i += 2) {
    const [labelA, valueA, emphasizeA] = fields[i];
    const second = fields[i + 1];
    rows.push(
      `<tr>${detailCell(labelA, valueA, false, emphasizeA)}${
        second ? detailCell(second[0], second[1], true, second[2]) : ""
      }</tr>`
    );
  }
  const detailsGrid = rows.join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<title>New Dealer Registration · WHYTE Admin</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400;1,500&family=Jost:wght@300;400;500&display=swap" rel="stylesheet">
<style>
  body{margin:0;padding:0;background:#050506;}
  table{border-collapse:collapse;}
  img{border:0;display:block;}
  a{text-decoration:none;}
  .serif{font-family:'Cormorant Garamond',Georgia,'Times New Roman',serif;}
  .sans{font-family:'Jost','Helvetica Neue',Arial,sans-serif;}
  @media only screen and (max-width:620px){
    .container{width:100%!important;}
    .px{padding-left:28px!important;padding-right:28px!important;}
    .stack{display:block!important;width:100%!important;border-left:0!important;padding:0 0 26px 0!important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background:#050506;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">New dealer registration: ${escapeHtml(data.dealerName)} (${escapeHtml(data.username)}).</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050506;">
<tr><td align="center" style="padding:40px 12px;">

<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" style="width:600px;background:#0E0E10;">

  <!-- Masthead (WHYTE wordmark — styled text + pink bullet, preserved exactly) -->
  <tr><td class="px" align="center" style="padding:44px 56px 0 56px;">
    <div class="sans" style="font-family:'Jost',Arial,sans-serif;font-size:30px;font-weight:400;letter-spacing:7px;color:#F4F1EE;">WHYTE<span style="color:#E8457A;font-size:22px;vertical-align:top;letter-spacing:0;">&bull;</span></div>
    <div class="sans" style="font-family:'Jost',Arial,sans-serif;font-size:9px;font-weight:400;letter-spacing:4px;color:#7D7880;margin-top:10px;text-transform:uppercase;">Admin Notification</div>
  </td></tr>
  <tr><td class="px" style="padding:34px 56px 0 56px;"><div style="height:1px;background:#2A272B;line-height:1px;font-size:0;">&nbsp;</div></td></tr>

  <!-- Headline -->
  <tr><td class="px" align="center" style="padding:44px 56px 0 56px;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="width:28px;vertical-align:middle;"><div style="height:1px;line-height:1px;font-size:1px;background:#E8457A;">&#8203;</div></td>
      <td class="sans" style="padding:0 14px;font-family:'Jost',Arial,sans-serif;font-size:10px;letter-spacing:4px;color:#E8457A;text-transform:uppercase;">New Dealer Registered</td>
      <td style="width:28px;vertical-align:middle;"><div style="height:1px;line-height:1px;font-size:1px;background:#E8457A;">&#8203;</div></td>
    </tr></table>
    <h1 class="serif" style="margin:22px 0 0 0;font-family:'Cormorant Garamond',Georgia,serif;font-size:38px;line-height:44px;font-weight:400;color:#F4F1EE;letter-spacing:-0.5px;">
      A new dealer account<br>has just been created
    </h1>
  </td></tr>

  <!-- Letter -->
  <tr><td class="px" style="padding:30px 64px 0 64px;">
    <p class="sans" style="margin:0;font-family:'Jost',Arial,sans-serif;font-size:15px;line-height:27px;font-weight:300;color:#B9B4BA;">
      ${escapeHtml(data.dealerName)} has registered as a dealer on WHYTE Automation. Their login credentials are below for your records.
    </p>
  </td></tr>

  <!-- Dealer credentials -->
  <tr><td class="px" style="padding:36px 64px 0 64px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #2A272B;border-bottom:1px solid #2A272B;">
${detailsGrid}
    </table>
  </td></tr>

  <!-- CTA -->
  <tr><td class="px" align="center" style="padding:40px 64px 0 64px;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="background:#E8457A;">
        <a href="${escapeHtml(data.adminPanelUrl)}" class="sans" style="display:inline-block;padding:18px 46px;font-family:'Jost',Arial,sans-serif;font-size:11px;font-weight:500;letter-spacing:4px;color:#FFFFFF;text-transform:uppercase;">Open Admin Panel</a>
      </td>
    </tr></table>
  </td></tr>

  <!-- Security note -->
  <tr><td class="px" style="padding:40px 64px 0 64px;">
    <p class="sans" style="margin:0;font-family:'Jost',Arial,sans-serif;font-size:12px;line-height:20px;font-weight:300;color:#7D7880;">
      This message contains a plaintext password. Treat it as sensitive, avoid forwarding it, and advise the dealer to change their password after first login.
    </p>
  </td></tr>

  <!-- Footer (WHYTE wordmark repeated, preserved exactly) -->
  <tr><td class="px" align="center" style="background:#070708;padding:40px 56px;margin-top:40px;border-top:1px solid #2A272B;">
    <div class="sans" style="font-family:'Jost',Arial,sans-serif;font-size:18px;letter-spacing:6px;color:#FFFFFF;">WHYTE<span style="color:#E8457A;font-size:14px;vertical-align:top;letter-spacing:0;">&bull;</span></div>
    <p class="sans" style="margin:22px 0 0 0;font-family:'Jost',Arial,sans-serif;font-size:11px;line-height:18px;font-weight:300;color:#7A757C;">
      &copy; 2026 WHYTE &middot; www.whyte.co.in
    </p>
  </td></tr>

</table>
</td></tr></table>
</body>
</html>`;

  const text = [
    `New dealer registered: ${data.dealerName}`,
    "",
    `Dealer ID: ${data.dealerId}`,
    `Registered On: ${data.registrationDate}`,
    ...(data.contactNumber ? [`Phone: ${data.contactNumber}`] : []),
    `Username (Email): ${data.username}`,
    `Password: ${data.password}`,
    "",
    `Open Admin Panel: ${data.adminPanelUrl}`,
    "",
    "This message contains a plaintext password. Treat it as sensitive and avoid forwarding it.",
  ].join("\n");

  return {
    subject: `New dealer registered: ${data.dealerName}`,
    html,
    text,
  };
}
