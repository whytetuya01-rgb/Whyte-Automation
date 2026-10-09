"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  User,
  Mail,
  Phone,
  Building,
  Lock,
  Shield,
  Percent,
  CheckCircle2,
  ArrowLeft,
  KeyRound,
  FileText,
  Clock,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import notify from "@/lib/notify";
import { Input, Button, Textarea, Badge } from "@/components/ui";
import LoadingSpinner from "@/components/shared/LoadingSpinner";
import { formatDate } from "@/lib/utils";
import { emailError, gstinError, mobileError, normalizeGstin } from "@/lib/validation/fields";

interface DealerProfileData {
  id: number;
  email: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  contactNumber: string | null;
  companyName: string | null;
  gstNumber: string | null;
  businessEmail: string | null;
  address: string | null;
  role: string;
  discountAllocationPercent: number;
  createdAt: string;
}

export default function DealerProfilePage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<DealerProfileData | null>(null);

  // Profile Form State
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [gstNumber, setGstNumber] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [address, setAddress] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});

  // Password Form State
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});

  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/dealer/profile");
      if (!res.ok) {
        if (res.status === 403) {
          router.replace("/");
          return;
        }
        throw new Error("Failed to load profile");
      }
      const data: DealerProfileData = await res.json();
      setProfile(data);
      setFirstName(data.firstName || "");
      setLastName(data.lastName || "");
      setContactNumber(data.contactNumber || "");
      setCompanyName(data.companyName || "");
      setGstNumber(data.gstNumber || "");
      setBusinessEmail(data.businessEmail || "");
      setAddress(data.address || "");
    } catch {
      notify.error("Error loading profile", "Unable to retrieve your dealer registration details.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }
    if (status === "authenticated" && role && role !== "dealer") {
      router.replace("/admin/dashboard");
      return;
    }

    if (status === "authenticated" && role === "dealer") {
      fetchProfile();
    }
  }, [status, role, router, fetchProfile]);

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileErrors({});

    const errors: Record<string, string> = {};
    if (!firstName.trim()) errors.firstName = "First name is required.";
    if (!lastName.trim()) errors.lastName = "Last name is required.";
    const contactErr = mobileError(contactNumber, { required: true });
    if (contactErr) errors.contactNumber = contactErr;
    if (!companyName.trim()) errors.companyName = "Company name is required.";
    const gstErr = gstinError(gstNumber, { required: true });
    if (gstErr) errors.gstNumber = gstErr;
    const businessEmailErr = emailError(businessEmail, { required: false });
    if (businessEmailErr) errors.businessEmail = businessEmailErr;
    if (!address.trim()) errors.address = "Company address is required.";

    if (Object.keys(errors).length > 0) {
      setProfileErrors(errors);
      return;
    }

    try {
      setSavingProfile(true);
      const res = await fetch("/api/dealer/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          contactNumber: contactNumber.trim(),
          companyName: companyName.trim(),
          gstNumber: normalizeGstin(gstNumber),
          businessEmail: businessEmail.trim() || null,
          address: address.trim(),
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        if (json.error?.field) {
          setProfileErrors({ [json.error.field]: json.error.message });
        }
        notify.error("Update failed", json.error?.message || "Could not update profile.");
        return;
      }

      setProfile(json.data);
      notify.success("Profile updated", "Your dealer registration details have been saved.");
    } catch {
      notify.error("Network error", "Failed to connect to the server.");
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordErrors({});

    const errors: Record<string, string> = {};
    if (!currentPassword) errors.currentPassword = "Enter your current password.";
    if (!newPassword) errors.newPassword = "Enter your new password.";
    else if (newPassword.length < 8) errors.newPassword = "New password must be at least 8 characters.";
    if (newPassword !== confirmPassword) errors.confirmPassword = "Passwords do not match.";

    if (Object.keys(errors).length > 0) {
      setPasswordErrors(errors);
      return;
    }

    try {
      setSavingPassword(true);
      const res = await fetch("/api/dealer/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        if (json.error?.field) {
          setPasswordErrors({ [json.error.field]: json.error.message });
        }
        notify.error("Password update failed", json.error?.message || "Current password may be incorrect.");
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      notify.success("Password changed", "Your security password has been updated successfully.");
    } catch {
      notify.error("Network error", "Failed to connect to the server.");
    } finally {
      setSavingPassword(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3">
        <LoadingSpinner size="lg" />
        <p className="text-sm font-medium text-gray-500">Loading your profile...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="text-center py-16">
        <AlertCircle className="mx-auto h-12 w-12 text-gray-300" />
        <h2 className="mt-4 text-lg font-bold text-gray-900">Profile Not Available</h2>
        <p className="mt-2 text-sm text-gray-500">We could not load your dealer profile information.</p>
        <Link href="/" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-gray-900 underline">
          <ArrowLeft size={16} />
          <span>Return to Quotations</span>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Top Breadcrumb & Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-gray-100">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-900 transition"
            >
              <ArrowLeft size={14} />
              <span>Quotations</span>
            </Link>
            <span className="text-gray-300 text-xs">/</span>
            <span className="text-xs font-semibold text-gray-900">Dealer Profile</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-gray-950">View Profile</h1>
            <Badge variant="secondary" className="bg-amber-50 text-amber-800 border-amber-200 text-xs font-semibold">
              Authorized Dealer
            </Badge>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            View and manage your registered dealership details and security credentials.
          </p>
        </div>

        <Link
          href="/"
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-gray-700 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition shadow-2xs shrink-0 self-start sm:self-auto"
        >
          <FileText size={15} />
          <span>My Quotations</span>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 Cols): Profile & Security Forms */}
        <div className="lg:col-span-2 space-y-6">
          {/* Personal & Business Details Form */}
          <section className="bg-white rounded-2xl border border-gray-100 shadow-xs overflow-hidden">
            <div className="px-6 py-4.5 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-gray-900 text-white flex items-center justify-center shrink-0">
                  <User size={16} />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-gray-900">Registration Details</h2>
                  <p className="text-[11px] text-gray-500">Contact information used across your proposals.</p>
                </div>
              </div>
            </div>

            <form onSubmit={handleProfileSubmit} className="p-6 space-y-4.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="First Name"
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  error={profileErrors.firstName}
                  placeholder="e.g. Rahul"
                />
                <Input
                  label="Last Name"
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  error={profileErrors.lastName}
                  placeholder="e.g. Sharma"
                />
              </div>

              <div>
                <Input
                  label="Login Email"
                  disabled
                  value={profile.email}
                  leftIcon={<Mail size={16} />}
                  helperText="Login email is verified and read-only. Contact Whyte administration to request an email update."
                  className="bg-gray-50 text-gray-500 cursor-not-allowed"
                />
              </div>

              <div>
                <Input
                  label="Company Name"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  error={profileErrors.companyName}
                  leftIcon={<Building size={16} />}
                  placeholder="Your company name"
                  helperText="Shown as the Authorized Dealer on your proposals."
                />
              </div>

              <div>
                <Input
                  label="Business Email"
                  value={businessEmail}
                  onChange={(e) => setBusinessEmail(e.target.value)}
                  error={profileErrors.businessEmail}
                  leftIcon={<Mail size={16} />}
                  placeholder="e.g. sales@yourcompany.com"
                  helperText="Optional — shown to clients on your proposals instead of your login email. Leave blank to show no email."
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Contact Number"
                  required
                  value={contactNumber}
                  onChange={(e) => setContactNumber(e.target.value)}
                  error={profileErrors.contactNumber}
                  leftIcon={<Phone size={16} />}
                  placeholder="10-digit mobile number"
                  helperText="Primary phone for proposal communication."
                />
                <Input
                  label="GST Number"
                  required
                  value={gstNumber}
                  onChange={(e) => setGstNumber(e.target.value.toUpperCase())}
                  error={profileErrors.gstNumber}
                  leftIcon={<FileText size={16} />}
                  placeholder="e.g. 27AAAAA0000A1Z5"
                  maxLength={15}
                  helperText="Displayed on generated proposal PDFs."
                />
              </div>

              <div>
                <Textarea
                  label="Company Address"
                  required
                  rows={3}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  error={profileErrors.address}
                  placeholder="Full office or showroom address"
                  helperText="Registered business location, shown on proposals."
                />
              </div>

              <div className="pt-2 flex justify-end">
                <Button
                  type="submit"
                  disabled={savingProfile}
                  className="bg-gray-950 hover:bg-gray-800 text-white text-xs font-semibold px-5 py-2.5 rounded-xl shadow-xs transition"
                >
                  {savingProfile ? (
                    <span className="flex items-center gap-2">
                      <LoadingSpinner size="sm" />
                      <span>Saving...</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <CheckCircle2 size={15} />
                      <span>Save Profile Changes</span>
                    </span>
                  )}
                </Button>
              </div>
            </form>
          </section>

          {/* Security & Password Change */}
          <section className="bg-white rounded-2xl border border-gray-100 shadow-xs overflow-hidden">
            <div className="px-6 py-4.5 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-gray-900 text-white flex items-center justify-center shrink-0">
                  <KeyRound size={16} />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-gray-900">Change Password</h2>
                  <p className="text-[11px] text-gray-500">Update your account login password.</p>
                </div>
              </div>
            </div>

            <form onSubmit={handlePasswordSubmit} className="p-6 space-y-4">
              <div>
                <Input
                  type="password"
                  label="Current Password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  error={passwordErrors.currentPassword}
                  leftIcon={<Lock size={16} />}
                  placeholder="Enter your existing password"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  type="password"
                  label="New Password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  error={passwordErrors.newPassword}
                  leftIcon={<Lock size={16} />}
                  placeholder="At least 8 characters"
                />
                <Input
                  type="password"
                  label="Confirm New Password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  error={passwordErrors.confirmPassword}
                  leftIcon={<Lock size={16} />}
                  placeholder="Repeat new password"
                />
              </div>

              <div className="pt-2 flex justify-end">
                <Button
                  type="submit"
                  disabled={savingPassword}
                  variant="outline"
                  className="border-gray-200 hover:bg-gray-50 text-gray-900 text-xs font-semibold px-5 py-2.5 rounded-xl shadow-2xs transition"
                >
                  {savingPassword ? (
                    <span className="flex items-center gap-2">
                      <LoadingSpinner size="sm" />
                      <span>Updating...</span>
                    </span>
                  ) : (
                    <span>Update Password</span>
                  )}
                </Button>
              </div>
            </form>
          </section>
        </div>

        {/* Right Column (1 Col): Dealership Status & Rep Information */}
        <div className="space-y-6">
          {/* Account Card */}
          <section className="bg-white rounded-2xl border border-gray-100 p-5 shadow-xs space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-gray-950 text-white flex items-center justify-center font-bold text-base shadow-2xs">
                {profile.name?.slice(0, 2).toUpperCase() || "DL"}
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-gray-900 truncate">{profile.name}</h3>
                <p className="text-xs text-gray-500 truncate">{profile.email}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" />
                  <span className="text-[11px] font-medium text-emerald-700">Account Active</span>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-gray-100 space-y-2 text-xs text-gray-600">
              <div className="flex items-center justify-between">
                <span className="text-gray-400 flex items-center gap-1">
                  <Clock size={13} />
                  <span>Member Since</span>
                </span>
                <span className="font-semibold text-gray-900">{formatDate(profile.createdAt)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400 flex items-center gap-1">
                  <Shield size={13} />
                  <span>Account ID</span>
                </span>
                <span className="font-mono text-gray-900">#{profile.id}</span>
              </div>
            </div>
          </section>

          {/* Account Administration Card */}
          <section className="bg-white rounded-2xl border border-gray-100 p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Account Oversight</h3>
              <Sparkles size={14} className="text-purple-600" />
            </div>

            <div className="space-y-3 pt-1">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-700 border border-purple-100 flex items-center justify-center font-bold text-sm shrink-0">
                  WA
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">Whyte Administration</p>
                  <p className="text-xs text-gray-500 truncate flex items-center gap-1 mt-0.5">
                    <Mail size={12} className="text-gray-400 shrink-0" />
                    <span>Direct Admin Oversight</span>
                  </p>
                </div>
              </div>
              <p className="text-[11px] text-gray-500 leading-relaxed bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                Your dealership account, discount limits, and quotation approvals are directly managed by Whyte Administration.
              </p>
            </div>
          </section>

          {/* Discount Allocation Card */}
          <section className="bg-white rounded-2xl border border-gray-100 p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Discount Allocation</h3>
              <Percent size={14} className="text-emerald-600" />
            </div>

            <div className="flex items-baseline gap-2 pt-1">
              <span className="text-3xl font-extrabold text-gray-950">
                {profile.discountAllocationPercent}%
              </span>
              <span className="text-xs font-medium text-gray-500">Maximum Allowed</span>
            </div>

            <p className="text-[11px] text-gray-500 leading-relaxed">
              This is your current approved discount limit set by Whyte administration. You can pass up to this percentage to customers on your proposals.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
