"use client";

import { useEffect, useState } from "react";
import { MailCheck } from "lucide-react";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";

interface Settings {
  profile: { name: string; email: string; role: string };
  reminders: { followUpEmails: boolean };
}

/** The signed-in person's morning email of follow-ups due today and overdue: on by default, and they can turn it off. */
export default function ReminderEmailCard() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiJson
      .get<Settings>("/api/account/settings")
      .then((data) => {
        if (!cancelled) setSettings(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load your settings.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (on: boolean) => {
    setSaving(true);
    try {
      const saved = await apiJson.patch<Settings>("/api/account/settings", { followUpReminderEmails: on });
      setSettings(saved);
      notify.success(on ? "Morning email on" : "Morning email off", on ? "You will get your follow-ups for the day each morning." : "You will no longer get the morning follow-up email.");
    } catch (err) {
      notifyApiError(err, "Could not save this setting");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Follow-up reminders" className="rounded-2xl border border-gray-200 bg-white p-5" data-testid="reminder-email-card">
      <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900">
        <MailCheck size={16} aria-hidden /> Follow-up reminders
      </h2>
      {error ? (
        <p role="alert" className="mt-2 text-sm font-medium text-amber-800">{error}</p>
      ) : !settings ? (
        <LoadingSpinner />
      ) : (
        <div className="mt-3 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900">Morning email</p>
            <p className="mt-0.5 text-xs text-gray-500">
              Each morning, one email to <span className="break-all font-medium text-gray-700">{settings.profile.email}</span> listing your follow-ups due today and the overdue ones. Nothing is sent on a day with none. The bell in the app shows them either way.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.reminders.followUpEmails}
            aria-label="Morning follow-up email"
            disabled={saving}
            onClick={() => void toggle(!settings.reminders.followUpEmails)}
            data-testid="reminder-email-toggle"
            className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50 ${settings.reminders.followUpEmails ? "bg-accent" : "bg-gray-300"}`}
          >
            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${settings.reminders.followUpEmails ? "translate-x-5" : "translate-x-0.5"}`} />
          </button>
        </div>
      )}
    </section>
  );
}
