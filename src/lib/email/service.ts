// Minimal, provider-agnostic transactional email sender.
//
// Uses Resend's HTTP API directly via `fetch` (no SDK dependency to add).
// Server-side only — never import this from client components.
//
// Required env vars for actual delivery:
//   RESEND_API_KEY   - secret API key from https://resend.com/api-keys
//   EMAIL_FROM       - verified sender, e.g. "WHYTE <no-reply@whyte.co.in>"
//
// If RESEND_API_KEY is not configured, sendEmail() logs a warning and
// no-ops instead of throwing, so unrelated flows (e.g. registration) never
// fail just because email delivery isn't set up yet.

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendEmailResult {
  sent: boolean;
  reason?: string;
  id?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    console.warn(
      "[email] Skipped sending email: RESEND_API_KEY and/or EMAIL_FROM is not configured.",
      { subject: input.subject, to: input.to }
    );
    return { sent: false, reason: "EMAIL_NOT_CONFIGURED" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error("[email] Provider rejected send request", { status: response.status, body });
      return { sent: false, reason: `PROVIDER_ERROR_${response.status}` };
    }

    const body = (await response.json().catch(() => null)) as { id?: string } | null;
    return { sent: true, id: body?.id };
  } catch (error) {
    console.error("[email] Failed to send email", error);
    return { sent: false, reason: "NETWORK_ERROR" };
  }
}
