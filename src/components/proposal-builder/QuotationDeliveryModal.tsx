"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCheck, CheckCircle2, Clock, Copy, Eye, Link2Off, Mail, MessageCircle, RefreshCw, RotateCcw, Send, XCircle } from "lucide-react";
import Modal from "@/components/shared/Modal";
import { Button, Input, Textarea } from "@/components/ui";
import notify from "@/lib/notify";
import { isValidEmail } from "@/lib/validation/fields";
import {
  DELIVERY_CHANNEL_LABELS,
  defaultWhatsAppMessage,
  deliveryEventLabel,
  deliveryStatusLabel,
  normalizeWhatsAppNumber,
  type DeliveryChannelValue,
  type DeliveryStatusValue,
  type QuotationDeliveryDto,
} from "@/lib/quotationDeliveryShared";
import { cn } from "@/lib/utils";

interface QuotationDeliveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  quotationId: string;
  quotationNumber: string;
  clientName: string;
  clientEmail: string | null;
  clientPhone?: string | null;
  companyName: string;
  /** Builds the same PDF as "Download PDF". */
  buildPdfBlob: () => Promise<Blob>;
  /** Fires after a send was accepted (e.g. to refresh the quotation status). */
  onSent?: () => void;
}

const STATUS_STYLE: Record<DeliveryStatusValue, { className: string; icon: React.ReactNode }> = {
  queued: { className: "bg-gray-100 text-gray-700 border-gray-200", icon: <Clock size={12} /> },
  sent: { className: "bg-sky-50 text-sky-800 border-sky-200", icon: <Send size={12} /> },
  delivered: { className: "bg-emerald-50 text-emerald-800 border-emerald-200", icon: <CheckCircle2 size={12} /> },
  read: { className: "bg-violet-50 text-violet-800 border-violet-200", icon: <CheckCheck size={12} /> },
  failed: { className: "bg-red-50 text-red-700 border-red-200", icon: <XCircle size={12} /> },
};

const CHANNEL_ICON: Record<DeliveryChannelValue, React.ReactNode> = {
  email: <Mail size={14} aria-hidden />,
  whatsapp: <MessageCircle size={14} aria-hidden />,
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

type FieldErrors = { to?: string; subject?: string; message?: string; form?: string };

/**
 * Send a quotation PDF by email or WhatsApp and follow what happened to it. Every send carries a secure view link;
 * the client opening it shows here as "Viewed" (with how many times). Email also reports sent / delivered / read /
 * failed from the email service, with Retry for failed sends. Links can be copied again or switched off.
 * Everything is enforced on the server.
 */
export default function QuotationDeliveryModal({
  isOpen,
  onClose,
  quotationId,
  quotationNumber,
  clientName,
  clientEmail,
  clientPhone,
  companyName,
  buildPdfBlob,
  onSent,
}: QuotationDeliveryModalProps) {
  const [channel, setChannel] = useState<DeliveryChannelValue>("email");
  const [to, setTo] = useState(clientEmail ?? "");
  const [subject, setSubject] = useState(`Quotation ${quotationNumber} from ${companyName}`);
  const [message, setMessage] = useState("");
  const [phone, setPhone] = useState(clientPhone ?? "");
  const [whatsappMessage, setWhatsappMessage] = useState(() => defaultWhatsAppMessage({ clientName, quotationNumber, companyName }));
  const [whatsappUrl, setWhatsappUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "pdf" | "sending">("idle");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [deliveries, setDeliveries] = useState<QuotationDeliveryDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/quotations/${quotationId}/deliveries`, { headers: { "x-skip-api-loader": "true" } });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        setLoadError(result?.error?.message ?? "Could not load the delivery history.");
        return;
      }
      setLoadError(null);
      setDeliveries(result.data as QuotationDeliveryDto[]);
    } catch {
      setLoadError("Could not reach the server to load the delivery history.");
    } finally {
      setLoading(false);
    }
  }, [quotationId]);

  // Load when opened; while open, refresh periodically so delivered / viewed updates appear on their own.
  useEffect(() => {
    if (!isOpen) return;
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => clearInterval(timer);
  }, [isOpen, load]);

  const upsert = (delivery: QuotationDeliveryDto) =>
    setDeliveries((previous) => [delivery, ...previous.filter((item) => item.id !== delivery.id)]);
  const replace = (delivery: QuotationDeliveryDto) =>
    setDeliveries((previous) => previous.map((item) => (item.id === delivery.id ? delivery : item)));

  const switchChannel = (next: DeliveryChannelValue) => {
    setChannel(next);
    setErrors({});
  };

  /** Builds the PDF and posts the delivery; returns the response data, or null after showing the error. */
  const submit = async (fields: Record<string, string>): Promise<(QuotationDeliveryDto & { whatsappUrl?: string }) | null> => {
    setPhase("pdf");
    const blob = await buildPdfBlob();
    setPhase("sending");
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) if (value) body.append(key, value);
    body.append("pdf", new File([blob], `${quotationNumber}.pdf`, { type: "application/pdf" }));
    const response = await fetch(`/api/quotations/${quotationId}/deliveries`, { method: "POST", body });
    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const field = result?.error?.field as keyof FieldErrors | undefined;
      const text = result?.error?.message ?? "The quotation could not be sent.";
      setErrors(field && ["to", "subject", "message"].includes(field) ? { [field]: text } : { form: text });
      notify.error("Quotation not sent", text);
      return null;
    }
    return result.data as QuotationDeliveryDto & { whatsappUrl?: string };
  };

  const sendEmail = async () => {
    const next: FieldErrors = {};
    if (!to.trim()) next.to = "Enter the client's email address.";
    else if (!isValidEmail(to.trim())) next.to = "Enter a valid email address.";
    if (!subject.trim()) next.subject = "Enter a subject.";
    else if (subject.length > 200) next.subject = "Subject must be 200 characters or fewer.";
    if (message.length > 2000) next.message = "Message must be 2000 characters or fewer.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    try {
      const delivery = await submit({ channel: "email", to: to.trim(), subject: subject.trim(), message: message.trim() });
      if (!delivery) return;
      upsert(delivery);
      if (delivery.status === "failed") {
        setErrors({ form: delivery.lastError?.message ?? "The quotation could not be sent." });
        notify.error("Quotation not sent", delivery.lastError?.message ?? "The email service did not accept the message.");
      } else {
        notify.success("Quotation sent", `Emailed to ${delivery.recipient}. Delivery updates appear below.`);
        setMessage("");
        onSent?.();
      }
    } catch {
      const text = "The PDF could not be prepared or the server could not be reached. Please try again.";
      setErrors({ form: text });
      notify.error("Quotation not sent", text);
    } finally {
      setPhase("idle");
    }
  };

  const shareWhatsApp = async () => {
    const next: FieldErrors = {};
    if (!phone.trim()) next.to = "Enter the client's WhatsApp number.";
    else if (!normalizeWhatsAppNumber(phone)) next.to = "Enter a valid mobile number (10 digits, or with the country code).";
    if (whatsappMessage.length > 1500) next.message = "Message must be 1500 characters or fewer.";
    setErrors(next);
    setWhatsappUrl(null);
    if (Object.keys(next).length > 0) return;

    // Opened now, while the click still counts as the user's action, so pop-up blockers allow it; it is pointed at
    // WhatsApp once the link exists. If the browser blocks it anyway, the "Open WhatsApp" button below does the same.
    const popup = window.open("", "_blank");
    if (popup) {
      popup.opener = null;
      popup.document.title = "Opening WhatsApp…";
      popup.document.body.textContent = "Preparing the quotation, WhatsApp opens in a moment…";
    }
    try {
      const delivery = await submit({ channel: "whatsapp", to: phone.trim(), message: whatsappMessage.trim() });
      if (!delivery || !delivery.whatsappUrl) {
        popup?.close();
        return;
      }
      const { whatsappUrl: url, ...dto } = delivery;
      upsert(dto);
      setWhatsappUrl(url);
      if (popup) popup.location.href = url;
      notify.success("WhatsApp is ready", "Press Send in WhatsApp. You will see here when the client opens the quotation.");
      onSent?.();
    } catch {
      popup?.close();
      const text = "The PDF could not be prepared or the server could not be reached. Please try again.";
      setErrors({ form: text });
      notify.error("Quotation not shared", text);
    } finally {
      setPhase("idle");
    }
  };

  const retry = async (delivery: QuotationDeliveryDto) => {
    setRetrying(delivery.id);
    try {
      const response = await fetch(`/api/quotations/${quotationId}/deliveries/${delivery.id}/retry`, { method: "POST" });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        notify.error("Retry failed", result?.error?.message ?? "The delivery could not be retried.");
        await load();
        return;
      }
      const updated = result.data as QuotationDeliveryDto;
      replace(updated);
      if (updated.status === "failed") notify.error("Retry failed", updated.lastError?.message ?? "The email service did not accept the message.");
      else {
        notify.success("Quotation sent", `Emailed to ${updated.recipient}.`);
        onSent?.();
      }
    } catch {
      notify.error("Retry failed", "Could not reach the server. Please try again.");
    } finally {
      setRetrying(null);
    }
  };

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      notify.success("Link copied", "Anyone with this link can view the quotation until it expires.");
    } catch {
      notify.error("Could not copy", url);
    }
  };

  const revoke = async (delivery: QuotationDeliveryDto) => {
    setRevoking(delivery.id);
    try {
      const response = await fetch(`/api/quotations/${quotationId}/deliveries/${delivery.id}/link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke" }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        notify.error("Link not switched off", result?.error?.message ?? "Please try again.");
        return;
      }
      replace(result.data as QuotationDeliveryDto);
      notify.success("Link switched off", "The client can no longer open the quotation from this link.");
    } catch {
      notify.error("Link not switched off", "Could not reach the server. Please try again.");
    } finally {
      setRevoking(null);
      setConfirmRevoke(null);
    }
  };

  const busy = phase !== "idle";
  const actionLabel = (idle: string) => (phase === "pdf" ? "Preparing PDF…" : phase === "sending" ? "Sending…" : idle);
  const formError = errors.form && (
    <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
      <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {errors.form}
    </p>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Send Quotation ${quotationNumber}`} size="2xl">
      <div className="space-y-6" data-testid="quotation-delivery">
        <div role="tablist" aria-label="Send by" className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1">
          {(["email", "whatsapp"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={channel === value}
              onClick={() => switchChannel(value)}
              disabled={busy}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60",
                channel === value ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
              )}
            >
              {CHANNEL_ICON[value]} {DELIVERY_CHANNEL_LABELS[value]}
            </button>
          ))}
        </div>

        {channel === "email" ? (
          <section aria-label="Send by email" className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="To (client email)" type="email" value={to} onChange={(e) => { setTo(e.target.value); setErrors({}); }} placeholder="client@example.com" error={errors.to} disabled={busy} />
              <Input label="Subject" value={subject} onChange={(e) => { setSubject(e.target.value); setErrors({}); }} error={errors.subject} disabled={busy} maxLength={220} />
            </div>
            <Textarea label="Message (optional)" rows={4} value={message} onChange={(e) => { setMessage(e.target.value); setErrors({}); }} placeholder={`Dear ${clientName}, please find our quotation attached…`} error={errors.message} disabled={busy} />
            <p className="flex items-center gap-1.5 text-xs text-gray-500">
              <Mail size={13} /> The PDF is attached, with a secure link to view it online. Replies go to your email address.
            </p>
            {formError}
            <div className="flex justify-end">
              <Button type="button" variant="primary" loading={busy} onClick={() => void sendEmail()}>
                {actionLabel("Send Quotation")}
              </Button>
            </div>
          </section>
        ) : (
          <section aria-label="Share on WhatsApp" className="space-y-3">
            <Input label="Client's WhatsApp number" type="tel" inputMode="tel" value={phone} onChange={(e) => { setPhone(e.target.value); setErrors({}); setWhatsappUrl(null); }} placeholder="98765 43210" error={errors.to} disabled={busy} />
            <Textarea label="Message" rows={3} value={whatsappMessage} onChange={(e) => { setWhatsappMessage(e.target.value); setErrors({}); }} error={errors.message} disabled={busy} maxLength={1600} />
            <p className="flex items-start gap-1.5 text-xs text-gray-500">
              <MessageCircle size={13} className="mt-0.5 shrink-0" /> WhatsApp opens with this message and a secure link to the PDF. Press Send there; you will see here when the client opens it.
            </p>
            {formError}
            {whatsappUrl && (
              <p className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                WhatsApp did not open?
                <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
                  Open WhatsApp
                </a>
              </p>
            )}
            <div className="flex justify-end">
              <Button type="button" variant="primary" loading={busy} onClick={() => void shareWhatsApp()}>
                {actionLabel("Share on WhatsApp")}
              </Button>
            </div>
          </section>
        )}

        <section aria-label="Delivery history" className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900">Delivery History</h3>
            <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1 text-xs font-semibold text-gray-600 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60">
              <RefreshCw size={12} className={loading ? "animate-spin" : undefined} /> Refresh
            </button>
          </div>
          {loadError && <p role="alert" className="text-sm text-red-600">{loadError}</p>}
          {!loadError && deliveries.length === 0 && <p className="text-sm text-gray-500">This quotation has not been sent yet.</p>}
          <ul className="space-y-2" data-testid="delivery-list">
            {deliveries.map((delivery) => {
              const style = STATUS_STYLE[delivery.status];
              const open = expanded === delivery.id;
              const { link } = delivery;
              return (
                <li key={delivery.id} className="rounded-xl border border-gray-200 bg-white p-3" data-testid="delivery-row" data-status={delivery.status} data-channel={delivery.channel}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-gray-900">
                        <span className="text-gray-500" title={DELIVERY_CHANNEL_LABELS[delivery.channel]}>{CHANNEL_ICON[delivery.channel]}</span>
                        {delivery.channel === "whatsapp" ? `+${delivery.recipient}` : delivery.recipient}
                      </p>
                      {delivery.channel === "email" && <p className="truncate text-xs text-gray-500">{delivery.subject}</p>}
                      <p className="mt-0.5 text-[11px] text-gray-400">
                        {when(delivery.createdAt)}
                        {deliveries.some((other) => other.revision > 1) ? <span className="font-semibold text-gray-600" data-testid="delivery-revision"> · Rev {delivery.revision}</span> : null}
                        {delivery.createdByName ? ` · by ${delivery.createdByName}` : ""}
                        {delivery.channel === "email" ? ` · attempt ${delivery.attempts} of ${delivery.maxAttempts}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold", style.className)} data-testid="delivery-status">
                        {style.icon} {deliveryStatusLabel(delivery)}
                      </span>
                      {delivery.canRetry && (
                        <Button type="button" variant="secondary" size="sm" loading={retrying === delivery.id} onClick={() => void retry(delivery)}>
                          <RotateCcw size={12} /> Retry
                        </Button>
                      )}
                    </div>
                  </div>
                  {delivery.status === "failed" && delivery.lastError && <p className="mt-2 text-xs font-medium text-red-700">{delivery.lastError.message}</p>}

                  {link.state !== "none" && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]" data-testid="delivery-link" data-link-state={link.state}>
                      <span className="inline-flex items-center gap-1 text-gray-600" data-testid="delivery-views">
                        <Eye size={12} aria-hidden />
                        {link.viewCount === 0 ? "Not opened yet" : `Opened ${link.viewCount} ${link.viewCount === 1 ? "time" : "times"} · last ${when(link.lastViewedAt)}`}
                      </span>
                      {link.state === "expired" && <span className="font-semibold text-amber-700">Link expired</span>}
                      {link.state === "revoked" && <span className="font-semibold text-gray-500">Link switched off</span>}
                      {link.state === "active" && link.url && (
                        <button type="button" onClick={() => void copyLink(link.url as string)} className="inline-flex items-center gap-1 font-semibold text-gray-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                          <Copy size={12} aria-hidden /> Copy link
                        </button>
                      )}
                      {link.state === "active" &&
                        (confirmRevoke === delivery.id ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="text-gray-600">Switch off this link?</span>
                            <button type="button" onClick={() => void revoke(delivery)} disabled={revoking === delivery.id} className="font-semibold text-red-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60">
                              {revoking === delivery.id ? "Switching off…" : "Yes, switch off"}
                            </button>
                            <button type="button" onClick={() => setConfirmRevoke(null)} className="font-semibold text-gray-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <button type="button" onClick={() => setConfirmRevoke(delivery.id)} className="inline-flex items-center gap-1 font-semibold text-gray-600 hover:text-red-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                            <Link2Off size={12} aria-hidden /> Switch off link
                          </button>
                        ))}
                    </div>
                  )}

                  <button type="button" onClick={() => setExpanded(open ? null : delivery.id)} className="mt-2 text-[11px] font-semibold text-gray-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-expanded={open}>
                    {open ? "Hide history" : `Show history (${delivery.events.length})`}
                  </button>
                  {open && (
                    <ol className="mt-2 space-y-1 border-l border-gray-200 pl-3" data-testid="delivery-events">
                      {[...delivery.events].reverse().map((event, index) => (
                        <li key={index} className="text-[11px] text-gray-600">
                          <span className="font-semibold text-gray-800">{deliveryEventLabel(event.type)}</span> · {when(event.at)}
                          {event.detail ? ` — ${event.detail}` : ""}
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-gray-400">
            &ldquo;Viewed&rdquo; means the client opened the secure link. Email delivered and read updates come from the email service; &ldquo;Read&rdquo; appears only when the client&apos;s mail app reports it.
          </p>
        </section>
      </div>
    </Modal>
  );
}
