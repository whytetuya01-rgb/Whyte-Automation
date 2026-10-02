import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { connectMongoDB } from "@/lib/mongodb";
import { AdminUser } from "@/models";

const ADMIN_PORTAL_ROLES = new Set(["super_admin", "admin"]);
const USER_PORTAL_ROLES = new Set(["dealer"]);

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "text" },
        password: { label: "Password", type: "password" },
        portal: { label: "Portal", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        await connectMongoDB();
        const email = credentials.email.toLowerCase().trim();

        const user = await AdminUser.findOne({ email }).lean();

        if (!user || !user.isActive) return null;

        const isValid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!isValid) return null;

        // The screen may state which portal it is signing into, but the role is
        // always loaded from the verified database user. A portal mismatch must
        // not create a session that can be used to cross the access boundary.
        const portal = credentials.portal;
        const permitted =
          (portal === "admin" && ADMIN_PORTAL_ROLES.has(user.role)) ||
          (portal === "user" && USER_PORTAL_ROLES.has(user.role));
        if (!permitted) return null;

        return {
          id: String((user as any).id || user._id),
          email: user.email,
          name: user.name ?? user.email,
          role: user.role,
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
      }
      return token;
    },
    async session({ session, token }: { session: any; token: any }) {
      if (session.user) {
        (session.user as any).role = token.role;
        (session.user as any).id = token.id;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  secret: process.env.NEXTAUTH_SECRET,
};
