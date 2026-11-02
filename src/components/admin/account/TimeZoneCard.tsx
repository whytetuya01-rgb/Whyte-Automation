"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Globe2 } from "lucide-react";
import { Button } from "@/components/ui";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import notify from "@/lib/notify";
import { apiJson, notifyApiError } from "@/lib/apiClient";
import { rememberUserTimeZone } from "@/lib/useUserTimeZone";

interface Settings {
  profile: { name: string; email: string; role: string };
  timeZone: { chosen: string | null; effective: string; default: string };
}

/** A few places people commonly work from, shown first. Everything else the browser knows follows. */
const COMMON_ZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Dhaka", "Asia/Kathmandu", "Asia/Colombo", "Europe/London", "Europe/Paris", "America/New_York", "America/Chicago", "America/Los_Angeles", "Australia/Sydney", "Pacific/Auckland", "UTC"];

function knownZones(): string[] {
  const supportedValuesOf = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  try {
    return supportedValuesOf ? supportedValuesOf("timeZone") : [];
  } catch {
    return [];
  }
}

function offsetOf(zone: string, at: Date): string {
  try {
    return new Intl.DateTimeFormat("en", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(at).find((part) => part.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/** The signed-in person's own time zone: what counts as "today" and "overdue" for them, and how follow-up times are shown. */
export default function TimeZoneCard() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    try {
      const data = await apiJson.get<Settings>("/api/account/settings");
      setSettings(data);
      setValue(data.timeZone.chosen ?? "");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your settings.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const options = useMemo(() => {
    const at = new Date();
    const rest = knownZones().filter((zone) => !COMMON_ZONES.includes(zone));
    const label = (zone: string) => `${zone.replace(/_/g, " ")} (${offsetOf(zone, at)})`;
    return { common: COMMON_ZONES.map((zone) => ({ zone, label: label(zone) })), rest: rest.map((zone) => ({ zone, label: label(zone) })) };
  }, []);

  if (error) {
    return (
      <section aria-label="Time zone" className="rounded-2xl border border-gray-200 bg-white p-5" data-testid="timezone-card">
        <p role="alert" className="text-sm font-medium text-amber-800">{error}</p>
      </section>
    );
  }
  if (!settings) {
    return (
      <section aria-label="Time zone" className="rounded-2xl border border-gray-200 bg-white p-5" data-testid="timezone-card">
        <LoadingSpinner />
      </section>
    );
  }

  const selected = value || settings.timeZone.default;
  const unchanged = (settings.timeZone.chosen ?? "") === value;
  const preview = (() => {
    try {
      return new Intl.DateTimeFormat("en-IN", { timeZone: selected, weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(now);
    } catch {
      return "";
    }
  })();

  const save = async () => {
    setSaving(true);
    try {
      const saved = await apiJson.patch<Settings>("/api/account/settings", { timeZone: value || null });
      setSettings(saved);
      setValue(saved.timeZone.chosen ?? "");
      rememberUserTimeZone(saved.timeZone.effective);
      notify.success("Time zone saved", `Follow-ups now use ${saved.timeZone.effective}.`);
    } catch (err) {
      notifyApiError(err, "Could not save your time zone");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label="Time zone" className="rounded-2xl border border-gray-200 bg-white p-5" data-testid="timezone-card">
      <h2 className="flex items-center gap-2 text-sm font-bold text-gray-900">
        <Globe2 size={16} aria-hidden /> Time zone
      </h2>
      <p className="mt-0.5 text-xs text-gray-500">
        Decides what counts as &ldquo;today&rdquo; and &ldquo;overdue&rdquo; for you and which time your follow-ups are shown in, here and in Google Calendar. Until you choose, it is {settings.timeZone.default} (India).
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="block min-w-0 flex-1 text-xs font-semibold text-gray-700">
          Your time zone
          <select
            value={value}
            onChange={(event) => setValue(event.target.value)}
            data-testid="timezone-select"
            className="mt-1 h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-normal text-gray-900 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
          >
            <option value="">Default: {settings.timeZone.default} (India)</option>
            <optgroup label="Common">
              {options.common.map((option) => (
                <option key={option.zone} value={option.zone}>{option.label}</option>
              ))}
            </optgroup>
            {options.rest.length > 0 && (
              <optgroup label="All time zones">
                {options.rest.map((option) => (
                  <option key={option.zone} value={option.zone}>{option.label}</option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        <Button type="button" variant="primary" size="sm" loading={saving} disabled={unchanged} onClick={() => void save()} data-testid="timezone-save">
          Save time zone
        </Button>
      </div>
      <p className="mt-2 text-xs text-gray-500" data-testid="timezone-preview">
        Right now it is <strong className="text-gray-800">{preview}</strong> in {selected}.
      </p>
    </section>
  );
}
