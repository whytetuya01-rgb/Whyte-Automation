"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCheck, CheckCircle2, Clock, Mail, RefreshCw, RotateCcw, Send, XCircle } from "lucide-react";
import Modal from "@/components/shared/Modal";
import { Button, Input, Textarea } from "@/components/ui";
import notify from "@/lib/notify";
import { isValidEmail } from "@/lib/validation/fields";
import { DELIVERY_STATUS_LABELS, type DeliveryStatusValue, type QuotationDeliveryDto } from "@/lib/quotationDeliveryShared";
import { cn } from "@/lib/utils";

interface QuotationDeliveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  quotationId: string;
  quotationNumber: string;
  clientName: string;
  clientEmail: string | null;
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

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

/**
 * Email a quotation PDF and follow what happened to it: sent, delivered, read (where the client's mail app reports
 * it) or failed, with the full history and a Retry for failed sends. Everything is enforced on the server.
 */
export default function QuotationDeliveryModal({
  isOpen,
  onClose,
  quotationId,
  quotationNumber,
  clientName,
  clientEmail,
  companyName,
  buildPdfBlob,
  onSent,
}: QuotationDeliveryModalProps) {
  const [to, setTo] = useState(clientEmail ?? "");
  const [subject, setSubject] = useState(`Quotation ${quotationNumber} from ${companyName}`);
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState<"idle" | "pdf" | "sending">("idle");
  const [errors, setErrors] = useState<{ to?: string; subject?: string; message?: string; form?: string }>({});
  const [deliveries, setDeliveries] = useState<QuotationDeliveryDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

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

  // Load when opened; while open, refresh periodically so delivered / read updates appear on their own.
  useEffect(() => {
    if (!isOpen) return;
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => clearInterval(timer);
  }, [isOpen, load]);

  const send = async () => {
    const next: typeof errors = {};
    if (!to.trim()) next.to = "Enter the client's email address.";
    else if (!isValidEmail(to.trim())) next.to = "Enter a valid email address.";
    if (!subject.trim()) next.subject = "Enter a subject.";
    else if (subject.length > 200) next.subject = "Subject must be 200 characters or fewer.";
    if (message.length > 2000) next.message = "Message must be 2000 characters or fewer.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    try {
      setPhase("pdf");
      const blob = await buildPdfBlob();
      setPhase("sending");
      const body = new FormData();
      body.append("to", to.trim());
      body.append("subject", subject.trim());
      if (message.trim()) body.append("message", message.trim());
      body.append("pdf", new File([blob], `${quotationNumber}.pdf`, { type: "application/pdf" }));
      const response = await fetch(`/api/quotations/${quotationId}/deliveries`, { method: "POST", body });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const field = result?.error?.field as keyof typeof errors | undefined;
        const text = result?.error?.message ?? "The quotation could not be sent.";
        setErrors(field && field !== "form" && ["to", "subject", "message"].includes(field) ? { [field]: text } : { form: text });
        notify.error("Quotation not sent", text);
        return;
      }
      const delivery = result.data as QuotationDeliveryDto;
      setDeliveries((previous) => [delivery, ...previous.filter((item) => item.id !== delivery.id)]);
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
      setDeliveries((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
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

  const busy = phase !== "idle";

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Send Quotation ${quotationNumber}`} size="2xl">
      <div className="space-y-6" data-testid="quotation-delivery">
        <section aria-label="Send by email" className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="To (client email)" type="email" value={to} onChange={(e) => { setTo(e.target.value); setErrors({}); }} placeholder="client@example.com" error={errors.to} disabled={busy} />
            <Input label="Subject" value={subject} onChange={(e) => { setSubject(e.target.value); setErrors({}); }} error={errors.subject} disabled={busy} maxLength={220} />
          </div>
          <Textarea label="Message (optional)" rows={4} value={message} onChange={(e) => { setMessage(e.target.value); setErrors({}); }} placeholder={`Dear ${clientName}, please find our quotation attached…`} error={errors.message} disabled={busy} />
          <p className="flex items-center gap-1.5 text-xs text-gray-500">
            <Mail size={13} /> The quotation PDF is attached. Replies go to your email address.
          </p>
          {errors.form && (
            <p role="alert" className="flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {errors.form}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="button" variant="primary" loading={busy} onClick={() => void send()}>
              {phase === "pdf" ? "Preparing PDF…" : phase === "sending" ? "Sending…" : "Send Quotation"}
            </Button>
          </div>
        </section>

        <section aria-label="Delivery history" className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900">Delivery History</h3>
            <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1 text-xs font-semibold text-gray-600 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60">
              <RefreshCw size={12} className={loading ? "animate-spin" : undefined} /> Refresh
            </button>
          </div>
          {loadError && <p role="alert" className="text-sm text-red-600">{loadError}</p>}
          {!loadError && deliveries.length === 0 && <p className="text-sm text-gray-500">This quotation has not been emailed yet.</p>}
          <ul className="space-y-2" data-testid="delivery-list">
            {deliveries.map((delivery) => {
              const style = STATUS_STYLE[delivery.status];
              const open = expanded === delivery.id;
              return (
                <li key={delivery.id} className="rounded-xl border border-gray-200 bg-white p-3" data-testid="delivery-row" data-status={delivery.status}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-900">{delivery.recipient}</p>
                      <p className="truncate text-xs text-gray-500">{delivery.subject}</p>
                      <p className="mt-0.5 text-[11px] text-gray-400">
                        {when(delivery.createdAt)}
                        {delivery.createdByName ? ` · by ${delivery.createdByName}` : ""} · attempt {delivery.attempts} of {delivery.maxAttempts}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold", style.className)} data-testid="delivery-status">
                        {style.icon} {DELIVERY_STATUS_LABELS[delivery.status]}
                      </span>
                      {delivery.canRetry && (
                        <Button type="button" variant="secondary" size="sm" loading={retrying === delivery.id} onClick={() => void retry(delivery)}>
                          <RotateCcw size={12} /> Retry
                        </Button>
                      )}
                    </div>
                  </div>
                  {delivery.status === "failed" && delivery.lastError && <p className="mt-2 text-xs font-medium text-red-700">{delivery.lastError.message}</p>}
                  <button type="button" onClick={() => setExpanded(open ? null : delivery.id)} className="mt-2 text-[11px] font-semibold text-gray-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" aria-expanded={open}>
                    {open ? "Hide history" : `Show history (${delivery.events.length})`}
                  </button>
                  {open && (
                    <ol className="mt-2 space-y-1 border-l border-gray-200 pl-3" data-testid="delivery-events">
                      {[...delivery.events].reverse().map((event, index) => (
                        <li key={index} className="text-[11px] text-gray-600">
                          <span className="font-semibold capitalize text-gray-800">{event.type}</span> · {when(event.at)}
                          {event.detail ? ` — ${event.detail}` : ""}
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-gray-400">Delivered and read updates come from the email service. &ldquo;Read&rdquo; appears only when the client&apos;s mail app reports it.</p>
        </section>
      </div>
    </Modal>
  );
}
