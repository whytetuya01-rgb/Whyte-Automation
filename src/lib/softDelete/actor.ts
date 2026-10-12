import type { Session } from "next-auth";
import { ApiError, UNAUTHENTICATED_MESSAGE } from "@/lib/api-response";

declare const deletionActorBrand: unique symbol;

/**
 * The authenticated user performing a delete / restore.
 *
 * Branded so it can only be produced by `actorFromSession()`: a value read
 * from a request body (`{ deletedBy: 7 }`) does not type-check as an actor.
 * `eslint.config.mjs` additionally forbids `as DeletionActor` outside this
 * module, so the brand cannot be forged with a cast.
 */
export interface DeletionActor {
  readonly id: number;
  readonly role: string;
  readonly [deletionActorBrand]: true;
}

/** Builds the actor from a session already verified by `requireRole()` / `requireSession()`. */
export function actorFromSession(session: Session): DeletionActor {
  const user = session.user as { id?: string | number; role?: string } | undefined;
  const id = Number(user?.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new ApiError("UNAUTHORIZED", UNAUTHENTICATED_MESSAGE);
  }
  const role = typeof user?.role === "string" ? user.role : "";
  if (!role) {
    throw new ApiError("FORBIDDEN", "You do not have permission to perform this action.");
  }
  return { id, role } as DeletionActor;
}
