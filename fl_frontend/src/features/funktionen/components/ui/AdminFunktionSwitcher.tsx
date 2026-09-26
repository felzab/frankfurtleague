import { getAdminSession } from "@/core/auth";
import { asSignInIdentifier } from "@/core/emailAddress";
import { APIBadStatusError, APIMalformedDataError, APINetworkError, ApiUnsentError } from "@/core/errors";
import { funktionenOf } from "@/core/funktionen";
import { logger } from "@/core/logging";
import { lookUpSubjekt } from "@/core/signInGate";
import { ADMIN_SHELL_FALLBACK } from "@/features/admin/constants";
import { FunktionSwitcher } from "@/shared/components/layout/sidemenu/FunktionSwitcher";

import { funktionOrteOf } from "../../utils";

import type { SubjectSession } from "@/core/subject";

/**
 * The administrator's switcher, under `AdminAuthGuard`: the records of the admin session's own address,
 * never through `getSubjectSession`, the person lane's guard, which reads the sign-in again and sets a
 * second actor (`docs/frontend/spec.md :: I394`).
 */
export async function AdminFunktionSwitcher() {
  // The guard's own read, memoised per render; `null` only where the guard above has already redirected.
  const served = await getAdminSession();
  if (served === null) return null;

  const email = asSignInIdentifier(served.user.email);
  let subjekt: SubjectSession["subjekt"];

  try {
    subjekt = await lookUpSubjekt(email);
  } catch (failed) {
    // Only the API's own failures: anything else is a defect, which the area's panel shows.
    if (!(
      failed instanceof APIBadStatusError ||
      failed instanceof APINetworkError ||
      failed instanceof APIMalformedDataError ||
      failed instanceof ApiUnsentError
    )) {
      throw failed;
    }
    // Nothing in the switcher's stead, never the area's crash panel: the administration is reachable
    // without the backend's answer, and the rail loses one row (`docs/frontend/spec.md :: I409`).
    logger.error("funktionen.admin_switcher_lookup_failed", failed, {
      error_code: failed.code,
      server_error_code: failed instanceof APIBadStatusError ? failed.serverErrorCode : undefined,
    });
    return null;
  }

  const { funktionen } = funktionenOf({ email: email, admin: true, subjekt: subjekt });

  return (
    <FunktionSwitcher
      orte={funktionOrteOf(funktionen)}
      ohneOrt={ADMIN_SHELL_FALLBACK.label}
      mitBereich
    />
  );
}
