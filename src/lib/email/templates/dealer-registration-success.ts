// Dealer registration success email.
//
// Visual source of truth: the "whyte-premium-noir.html" reference template
// supplied for this task. Structure, palette, typography, spacing and the
// WHYTE wordmark markup below are reproduced as-is from that file — only
// the dynamic content (dealer details, CTA link, experience copy) changes.
//
// Note on the reference template's hero photo: that file embeds the hero
// image as an inline base64 JPEG. Transactional email is safer and lighter
// without large inline base64 images (many clients strip/block them, and
// they bloat the message past spam-filter size thresholds), so this
// template instead references the hero image via an external URL
// (EMAIL_HERO_IMAGE_URL). If that env var isn't set, the hero block is
// simply omitted — never a broken image icon. The WHYTE wordmark itself
// (the actual logo) is NOT an image in the reference file — it's styled
// text ("WHYTE" + a pink bullet), reproduced verbatim below in both the
// masthead and the footer.

export interface DealerRegistrationEmailData {
  firstName: string;
  dealerName: string;
  dealerId: string;
  email: string;
  phone: string | null;
  companyName: string | null;
  registrationDate: string;
  loginUrl: string;
  supportEmail: string;
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

/** One cell of the dealer-details grid; omitted entirely when value is null/empty. */
function detailCell(label: string, value: string | null, borderLeft: boolean): string {
  if (!value) return "";
  const border = borderLeft ? "border-left:1px solid #2A272B;" : "";
  return `
        <td class="stack" width="50%" valign="top" style="padding:22px 0 22px ${borderLeft ? "24px" : "0"};${border}">
          <div class="sans" style="font-family:'Jost',Arial,sans-serif;font-size:9px;letter-spacing:3px;color:#7D7880;text-transform:uppercase;">${label}</div>
          <div class="serif" style="font-family:'Cormorant Garamond',Georgia,serif;font-size:22px;color:#F4F1EE;margin-top:6px;">${escapeHtml(value)}</div>
        </td>`;
}

export function renderDealerRegistrationSuccessEmail(data: DealerRegistrationEmailData): RenderedEmail {
  const heroImageUrl = process.env.EMAIL_HERO_IMAGE_URL || "";

  const fields: Array<[string, string | null]> = [
    ["Dealer ID", data.dealerId],
    ["Registered On", data.registrationDate],
    ["Dealer Name", data.dealerName],
    ["Email", data.email],
    ["Phone", data.phone],
    ["Company", data.companyName],
  ].filter(([, value]) => !!value) as Array<[string, string | null]>;

  const rows: string[] = [];
  for (let i = 0; i < fields.length; i += 2) {
    const [labelA, valueA] = fields[i];
    const second = fields[i + 1];
    rows.push(
      `<tr>${detailCell(labelA, valueA, false)}${second ? detailCell(second[0], second[1], true) : ""}</tr>`
    );
  }
  const detailsGrid = rows.join("\n");

  const heroBlock = heroImageUrl
    ? `
  <tr><td align="center" style="padding:30px 40px 0 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F9F7F8;"><tr><td align="center" style="padding:18px 18px 0 18px;">
    <img class="full" src="${escapeHtml(heroImageUrl)}" width="484" alt="WHYTE smart residence and control app" style="width:484px;max-width:100%;height:auto;">
  </td></tr></table></td></tr>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<title>Welcome to WHYTE · Noir</title>
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
    .h1{font-size:40px!important;line-height:44px!important;}
    .stack{display:block!important;width:100%!important;border-left:0!important;padding:0 0 26px 0!important;}
    .full{width:100%!important;height:auto!important;}
  }
</style>
</head>
<body style="margin:0;padding:0;background:#050506;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Dear ${escapeHtml(data.firstName)}, your WHYTE account is now active.</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050506;">
<tr><td align="center" style="padding:40px 12px;">

<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" style="width:600px;background:#0E0E10;">

  <!-- Masthead (WHYTE wordmark — styled text + pink bullet, preserved exactly) -->
  <tr><td class="px" align="center" style="padding:44px 56px 0 56px;">
    <div class="sans" style="font-family:'Jost',Arial,sans-serif;font-size:30px;font-weight:400;letter-spacing:7px;color:#F4F1EE;">WHYTE<span style="color:#E8457A;font-size:22px;vertical-align:top;letter-spacing:0;">&bull;</span></div>
    <div class="sans" style="font-family:'Jost',Arial,sans-serif;font-size:9px;font-weight:400;letter-spacing:4px;color:#7D7880;margin-top:10px;text-transform:uppercase;">Next-gen smart living ecosystems</div>
  </td></tr>
  <tr><td class="px" style="padding:34px 56px 0 56px;"><div style="height:1px;background:#2A272B;line-height:1px;font-size:0;">&nbsp;</div></td></tr>

  <!-- Headline -->
  <tr><td class="px" align="center" style="padding:44px 56px 0 56px;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="width:28px;vertical-align:middle;"><div style="height:1px;line-height:1px;font-size:1px;background:#E8457A;">&#8203;</div></td>
      <td class="sans" style="padding:0 14px;font-family:'Jost',Arial,sans-serif;font-size:10px;letter-spacing:4px;color:#E8457A;text-transform:uppercase;">Registration Confirmed</td>
      <td style="width:28px;vertical-align:middle;"><div style="height:1px;line-height:1px;font-size:1px;background:#E8457A;">&#8203;</div></td>
    </tr></table>
    <h1 class="h1 serif" style="margin:22px 0 0 0;font-family:'Cormorant Garamond',Georgia,serif;font-size:52px;line-height:56px;font-weight:400;color:#F4F1EE;letter-spacing:-0.5px;">
      Welcome to the <em style="font-style:italic;color:#E8457A;">art</em><br>of intelligent living
    </h1>
  </td></tr>
${heroBlock}

  <!-- Letter -->
  <tr><td class="px" style="padding:30px 64px 0 64px;">
    <p class="serif" style="margin:0;font-family:'Cormorant Garamond',Georgia,serif;font-size:24px;font-style:italic;color:#F4F1EE;">Dear ${escapeHtml(data.firstName)},</p>
    <p class="sans" style="margin:16px 0 0 0;font-family:'Jost',Arial,sans-serif;font-size:15px;line-height:27px;font-weight:300;color:#B9B4BA;">
      Thank you for registering with WHYTE.<br>
      Your account has been successfully created and is now ready to use.
    </p>
    <p class="sans" style="margin:16px 0 0 0;font-family:'Jost',Arial,sans-serif;font-size:15px;line-height:27px;font-weight:300;color:#B9B4BA;">
      Your WHYTE account is now active — giving you access to a smarter, more connected living experience.
    </p>
  </td></tr>

  <!-- Dealer details -->
  <tr><td class="px" style="padding:36px 64px 0 64px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #2A272B;border-bottom:1px solid #2A272B;">
${detailsGrid}
    </table>
  </td></tr>

  <!-- CTA -->
  <tr><td class="px" align="center" style="padding:40px 64px 0 64px;">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="background:#E8457A;">
        <a href="${escapeHtml(data.loginUrl)}" class="sans" style="display:inline-block;padding:18px 46px;font-family:'Jost',Arial,sans-serif;font-size:11px;font-weight:500;letter-spacing:4px;color:#FFFFFF;text-transform:uppercase;">Enter WHYTE Automation</a>
      </td>
    </tr></table>
    <p class="sans" style="margin:16px 0 0 0;font-family:'Jost',Arial,sans-serif;font-size:12px;font-weight:300;color:#7D7880;">or sign in anytime at <a href="https://www.whyte.co.in" style="color:#E8457A;">whyte.co.in</a></p>
  </td></tr>

  <!-- Experience -->
  <tr><td class="px" style="padding:56px 56px 0 56px;">
    <p class="sans" align="center" style="margin:0 0 26px 0;font-family:'Jost',Arial,sans-serif;font-size:10px;letter-spacing:4px;color:#7D7880;text-transform:uppercase;text-align:center;">The WHYTE Experience</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td class="stack" width="33%" valign="top" align="center" style="padding:0 14px;">
        <div class="serif" style="font-family:'Cormorant Garamond',Georgia,serif;font-size:30px;font-style:italic;color:#E8457A;">I</div>
        <div class="serif" style="font-family:'Cormorant Garamond',Georgia,serif;font-size:19px;color:#F4F1EE;margin-top:6px;">Partner Onboarding</div>
        <div class="sans" style="font-family:'Jost',Arial,sans-serif;font-size:12px;line-height:19px;font-weight:300;color:#8F8A90;margin-top:6px;">A dedicated introduction to the WHYTE dealer network.</div>
      </td>
      <td class="stack" width="33%" valign="top" align="center" style="padding:0 14px;border-left:1px solid #2A272B;">
        <div class="serif" style="font-family:'Cormorant Garamond',Georgia,serif;font-size:30px;font-style:italic;color:#E8457A;">II</div>
        <div class="serif" style="font-family:'Cormorant Garamond',Georgia,serif;font-size:19px;color:#F4F1EE;margin-top:6px;">Project Support</div>
        <div class="sans" style="font-family:'Jost',Arial,sans-serif;font-size:12px;line-height:19px;font-weight:300;color:#8F8A90;margin-top:6px;">Specification and design backing for every installation.</div>
      </td>
      <td class="stack" width="33%" valign="top" align="center" style="padding:0 14px;border-left:1px solid #2A272B;">
        <div class="serif" style="font-family:'Cormorant Garamond',Georgia,serif;font-size:30px;font-style:italic;color:#E8457A;">III</div>
        <div class="serif" style="font-family:'Cormorant Garamond',Georgia,serif;font-size:19px;color:#F4F1EE;margin-top:6px;">Dealer Portal</div>
        <div class="sans" style="font-family:'Jost',Arial,sans-serif;font-size:12px;line-height:19px;font-weight:300;color:#8F8A90;margin-top:6px;">Quotations, proposals and earnings — all in one place.</div>
      </td>
    </tr></table>
  </td></tr>

  <!-- Sign-off -->
  <tr><td class="px" align="center" style="padding:56px 56px 52px 56px;">
    <div style="width:40px;height:1px;background:#E8457A;line-height:1px;font-size:0;margin:0 auto;">&nbsp;</div>
    <p class="serif" style="margin:24px 0 0 0;font-family:'Cormorant Garamond',Georgia,serif;font-size:21px;font-style:italic;color:#B9B4BA;">With warm regards,</p>
    <p class="sans" style="margin:6px 0 0 0;font-family:'Jost',Arial,sans-serif;font-size:11px;letter-spacing:4px;color:#F4F1EE;text-transform:uppercase;">The WHYTE Team</p>
  </td></tr>

  <!-- Footer (WHYTE wordmark repeated, preserved exactly) -->
  <tr><td class="px" align="center" style="background:#070708;padding:40px 56px;border-top:1px solid #2A272B;">
    <div class="sans" style="font-family:'Jost',Arial,sans-serif;font-size:18px;letter-spacing:6px;color:#FFFFFF;">WHYTE<span style="color:#E8457A;font-size:14px;vertical-align:top;letter-spacing:0;">&bull;</span></div>
    <p class="sans" style="margin:18px 0 0 0;font-family:'Jost',Arial,sans-serif;font-size:10px;letter-spacing:3px;text-transform:uppercase;">
      <a href="https://www.whyte.co.in" style="color:#BDB8BE;">Website</a>
      <span style="color:#B9B4BA;">&nbsp;&nbsp;|&nbsp;&nbsp;</span>
      <a href="mailto:${escapeHtml(data.supportEmail)}" style="color:#BDB8BE;">Concierge</a>
      <span style="color:#B9B4BA;">&nbsp;&nbsp;|&nbsp;&nbsp;</span>
      <a href="${escapeHtml(data.loginUrl)}" style="color:#BDB8BE;">Dashboard</a>
    </p>
    <p class="sans" style="margin:22px 0 0 0;font-family:'Jost',Arial,sans-serif;font-size:11px;line-height:18px;font-weight:300;color:#7A757C;">
      If you did not create this account, please <a href="mailto:${escapeHtml(data.supportEmail)}" style="color:#E8457A;">contact us</a> immediately.<br>
      &copy; 2026 WHYTE &middot; www.whyte.co.in
    </p>
  </td></tr>

</table>
</td></tr></table>
</body>
</html>`;

  const textLines = [
    `Dear ${data.firstName},`,
    "",
    "Thank you for registering with WHYTE. Your account has been successfully created and is now ready to use.",
    "",
    "Your WHYTE account is now active — giving you access to a smarter, more connected living experience.",
    "",
    `Dealer ID: ${data.dealerId}`,
    `Registered On: ${data.registrationDate}`,
    `Dealer Name: ${data.dealerName}`,
    `Email: ${data.email}`,
    ...(data.phone ? [`Phone: ${data.phone}`] : []),
    ...(data.companyName ? [`Company: ${data.companyName}`] : []),
    "",
    `Enter WHYTE Automation: ${data.loginUrl}`,
    "or sign in anytime at whyte.co.in",
    "",
    "With warm regards,",
    "The WHYTE Team",
    "",
    `If you did not create this account, please contact us immediately at ${data.supportEmail}.`,
    "© 2026 WHYTE · www.whyte.co.in",
  ];

  return {
    subject: "Welcome to WHYTE — your dealer account is active",
    html,
    text: textLines.join("\n"),
  };
}
