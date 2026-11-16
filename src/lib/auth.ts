import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser, Company } from "@/models";
import { runUnscoped } from "@/lib/tenant/context";
import { reviewBlockFor } from "@/lib/companyReviewStatus";
import { resolveAccountCompany } from "@/lib/tenant/accountCompany";
import {
  checkLoginRateLimit,
  recordFailedLoginAttempt,
  recordSuccessfulLogin,
  constantTimeDummyCompare,
  extractClientIpFromAuthRequest,
  logSecurityEvent,
} from "@/lib/authRateLimit";

const ADMIN_PORTAL_ROLES = new Set(["super_admin", "company_owner", "admin", "configurable_admin"]);
// The workspace at /login is for the people who build quotations: dealers and the company's sales executives.
const USER_PORTAL_ROLES = new Set(["dealer", "sales_executive"]);

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
        portal: { label: "Portal", type: "text" },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = credentials.email.toLowerCase().trim();
        const portal = credentials.portal || "user";
        const clientIp = extractClientIpFromAuthRequest(req);

        // 1. Enforce shared persistent rate limiting (both per-account and per-IP)
        const rateCheck = await checkLoginRateLimit({ email, ip: clientIp });
        if (!rateCheck.allowed) {
          logSecurityEvent("LOGIN_RATE_LIMITED", {
            email,
            ip: clientIp,
            portal,
            reason: rateCheck.reason,
            retryAfterSeconds: rateCheck.retryAfterSeconds,
          });
          throw new Error("RATE_LIMITED");
        }

        await connectMongoDB();

        // No tenant context exists yet — resolving WHICH company a login
        // belongs to is the entire point of this lookup, so it must run
        // unscoped (this is "auth-lookup", the one reason the tenant-scope
        // plugin's own docs name for exactly this chicken-and-egg case).
        // Must be an async callback that AWAITS internally, not a bare arrow
        // returning the un-awaited query: Mongoose queries are lazy
        // thenables that only actually execute (and fire the tenant-scope
        // plugin's hooks) when something calls `.then()`/awaits them. If
        // that happened outside `runUnscoped`'s callback, the query would
        // run with no tenant context at all and the plugin would throw.
        const user = await runUnscoped("auth-lookup", async () => await AdminUser.findOne({ email }).lean());

        // 2. Generic error & timing-attack mitigation:
        // When a user does not exist or is inactive, run constant-time dummy bcrypt
        // comparison so duration is indistinguishable from real credential checks.
        if (!user || user.isActive === false) {
          await constantTimeDummyCompare(credentials.password);
          await recordFailedLoginAttempt({ email, ip: clientIp });
          logSecurityEvent("LOGIN_FAILED", {
            email,
            ip: clientIp,
            portal,
            reason: "INVALID_CREDENTIALS",
          });
          return null;
        }

        const isValid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!isValid) {
          await recordFailedLoginAttempt({ email, ip: clientIp });
          logSecurityEvent("LOGIN_FAILED", {
            email,
            ip: clientIp,
            portal,
            reason: "INVALID_CREDENTIALS",
          });
          return null;
        }

        // 3. Clear failed login attempts on successful credentials authentication
        await recordSuccessfulLogin({ email, ip: clientIp });

        // Strict portal separation:
        // - /admin/login only accepts admin and super_admin accounts
        // - /login only accepts dealer accounts
        if (portal === "admin") {
          if (!ADMIN_PORTAL_ROLES.has(user.role)) {
            throw new Error("DEALER_IN_ADMIN_PORTAL");
          }
        } else if (portal === "user") {
          if (!USER_PORTAL_ROLES.has(user.role)) {
            throw new Error("ADMIN_IN_USER_PORTAL");
          }
        } else {
          return null;
        }

        // The platform Super Admin has no company. Every other role must carry an
        // explicit, existing company: a missing companyId is NEVER assumed to be
        // Company 1 (refuse the login instead). Block only a suspended company.
        const account = resolveAccountCompany(user.role, (user as { companyId?: unknown }).companyId);
        if (!account.ok) return null;
        const resolvedCompanyId = account.companyId;
        if (resolvedCompanyId !== null) {
          const company = await Company.findById(resolvedCompanyId).select("status registrationStatus").lean();
          if (!company) return null;
          // A deactivated company blocks every one of its users (owner, admins, dealers). The reason is shown
          // only after the password matched, like the review states below.
          if (company.status === "suspended") throw new Error("COMPANY_DEACTIVATED");
          // Self-registered companies cannot sign in until a Super Admin approves them. Reported only now, after
          // the password matched, so the review state is never revealed to someone who merely knows an email.
          const blocked = reviewBlockFor(company.registrationStatus);
          if (blocked) throw new Error(blocked);
        }

        logSecurityEvent("LOGIN_SUCCESS", {
          email,
          ip: clientIp,
          portal,
          userId: String((user as any).id || user._id),
          role: user.role,
        });

        return {
          id: String((user as any).id || user._id),
          email: user.email,
          name: user.name ?? user.email,
          role: user.role,
          companyId: resolvedCompanyId,
          permissions: (user as any).permissions ?? [],
        };
      },
    }),
  ],
  session: {
    strategy: "jwt" as const,
  },
  callbacks: {
    async jwt({ token, user }: { token: any; user: any }) {
      if (user) {
        token.role = (user as any).role;
        token.id = user.id;
        token.companyId = (user as any).companyId ?? null;
        token.permissions = (user as any).permissions ?? [];
      }
      return token;
    },
    async session({ session, token }: { session: any; token: any }) {
      if (session.user) {
        (session.user as any).role = token.role;
        (session.user as any).id = token.id;
        (session.user as any).companyId = token.companyId ?? null;
        (session.user as any).permissions = token.permissions ?? [];
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  secret: process.env.NEXTAUTH_SECRET,
};
