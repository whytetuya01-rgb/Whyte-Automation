import type { DefaultSession } from "next-auth";

/**
 * Type augmentations for the installed NextAuth package.
 *
 * This file must be a *module* (note the top-level import) so that the
 * `declare module` blocks below merge with the real `next-auth` types instead of
 * replacing them. Declaring them in a script file would hide the package's own
 * exports — for example `getToken` from `next-auth/jwt`, which the request gate
 * in `src/proxy.ts` relies on.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
    } & DefaultSession["user"];
  }

  interface User {
    role: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: string;
    id: string;
  }
}
