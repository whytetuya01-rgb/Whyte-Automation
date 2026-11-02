"use client";

import { useEffect, useState } from "react";
import { apiJson } from "@/lib/apiClient";
import { FOLLOW_UP_TIME_ZONE } from "@/lib/followUps";

/**
 * The signed-in person's time zone (the one they chose on My account, or Asia/Kolkata), for screens that decide what is
 * "today" or "overdue" or show a follow-up time. Asked of the server once per page load and shared by every component;
 * until the answer arrives, and for anyone who has no account page, it is Asia/Kolkata (the old behaviour).
 */
let known: string | null = null;
let asking: Promise<string> | null = null;
const listeners = new Set<(zone: string) => void>();

function ask(): Promise<string> {
  asking ??= apiJson
    .get<{ timeZone: { effective: string } }>("/api/account/settings")
    .then((settings) => settings.timeZone.effective)
    .catch(() => FOLLOW_UP_TIME_ZONE)
    .then((zone) => {
      known = zone;
      listeners.forEach((listener) => listener(zone));
      return zone;
    });
  return asking;
}

/** Called by My account after a save, so every open screen switches at once. */
export function rememberUserTimeZone(zone: string): void {
  known = zone;
  asking = Promise.resolve(zone);
  listeners.forEach((listener) => listener(zone));
}

export function useUserTimeZone(): string {
  const [zone, setZone] = useState<string>(known ?? FOLLOW_UP_TIME_ZONE);
  useEffect(() => {
    listeners.add(setZone);
    if (known) setZone(known);
    else void ask();
    return () => {
      listeners.delete(setZone);
    };
  }, []);
  return zone;
}
