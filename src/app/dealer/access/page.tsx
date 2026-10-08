import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { authOptions } from "@/lib/auth";
import WhyteLogo from "@/components/shared/WhyteLogo";
import SignOutButton from "@/components/shared/SignOutButton";
import { isSessionActorStillValid } from "@/lib/sessionGuard";

export default async function DealerAccessPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const role = (session.user as { role?: string }).role;
  if (role === "dealer" || role === "sales") redirect("/");

  const userId = Number((session.user as { id?: string }).id);
  if (!role || !(await isSessionActorStillValid(userId, role))) {
    redirect("/login");
  }
  redirect("/admin/dashboard");

  return (
    <main className="admin-theme min-h-screen bg-neutral-50 flex items-center justify-center p-6">
      <section className="w-full max-w-lg rounded-2xl border border-neutral-200 bg-white p-8 sm:p-10 shadow-sm text-center">
        <div className="mb-8 flex justify-center">
          <div className="inline-flex items-center rounded-xl bg-white px-3 py-1.5 shadow-xs border border-neutral-200">
            <WhyteLogo theme="light" alt="Whyte logo" size="login" preload />
          </div>
        </div>
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-admin-primary-soft text-admin-primary">
          <ShieldCheck size={24} />
        </div>
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-neutral-950">Dealer account active</h1>
        <p className="mt-3 text-sm leading-relaxed text-neutral-600">
          Your account is ready. Dealer access to the catalog and quotation workspace has not been enabled yet. Please contact your Whyte administrator for assistance.
        </p>
        <p className="mt-2 text-sm text-neutral-500">Signed in as {session.user.email}</p>
        <SignOutButton
          callbackUrl="/login"
          className="mt-7 inline-flex text-sm font-medium text-neutral-700 underline underline-offset-4 hover:text-black cursor-pointer"
        >
          Sign out
        </SignOutButton>
      </section>
    </main>
  );
}
