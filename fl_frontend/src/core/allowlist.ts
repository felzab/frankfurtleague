import "server-only";

import { frontend_config } from "./config";
import { asSignInIdentifier } from "./emailAddress";

// Its own module rather than `fl_frontend/src/core/auth.ts`'s, so the send gate that module calls
// reads the same verdict without importing the module that calls it.
export function isUserAdmin(email?: string | null): boolean {
  if (!email || !frontend_config.ALLOWED_ADMIN_EMAILS) return false;

  // Folded here because the library folds only CASE, and only on the row it stores: the address a
  // send is judged on arrives exactly as it was typed, and an allowlist entry is stored folded
  // (`fl_frontend/src/core/emailAddress.ts :: asSignInIdentifier`).
  return frontend_config.ALLOWED_ADMIN_EMAILS.includes(asSignInIdentifier(email));
}
