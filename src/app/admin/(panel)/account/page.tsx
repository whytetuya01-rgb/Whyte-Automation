"use client";

import { useEffect, useState } from "react";
import { UserCog } from "lucide-react";
import PageHeader from "@/components/admin/PageHeader";
import TimeZoneCard from "@/components/admin/account/TimeZoneCard";
import { apiJson } from "@/lib/apiClient";

interface Profile {
  profile: { name: string; email: string; role: string };
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  company_owner: "Company Owner",
  admin: "Admin",
  configurable_admin: "Team member",
};

/** The signed-in person's own settings. Nobody can open or change anyone else's from here. */
export default function MyAccountPage() {
  const [profile, setProfile] = useState<Profile["profile"] | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiJson
      .get<Profile>("/api/account/settings")
      .then((data) => {
        if (!cancelled) setProfile(data.profile);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader title="My account" icon={UserCog} subtitle="Your own settings. They apply only to you." />

      <section aria-label="Profile" className="rounded-2xl border border-gray-200 bg-white p-5" data-testid="account-profile">
        <h2 className="text-sm font-bold text-gray-900">Signed in as</h2>
        {profile ? (
          <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs font-semibold text-gray-500">Name</dt>
              <dd className="font-medium text-gray-900" data-testid="account-name">{profile.name || "—"}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs font-semibold text-gray-500">Email</dt>
              <dd className="truncate font-medium text-gray-900" data-testid="account-email">{profile.email}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-gray-500">Role</dt>
              <dd className="font-medium text-gray-900">{ROLE_LABELS[profile.role] ?? profile.role}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-2 text-xs text-gray-400">Loading…</p>
        )}
      </section>

      <TimeZoneCard />
    </div>
  );
}
