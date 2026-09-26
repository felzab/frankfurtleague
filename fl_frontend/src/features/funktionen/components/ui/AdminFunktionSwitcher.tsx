import { getAdminSession } from "@/core/auth";
import { asSignInIdentifier } from "@/core/emailAddress";
import { funktionenOf } from "@/core/funktionen";
import { lookUpSubjekt } from "@/core/signInGate";
import { ADMIN_SHELL_FALLBACK } from "@/features/admin/constants";
import { FunktionSwitcher } from "@/shared/components/layout/sidemenu/FunktionSwitcher";

import { funktionOrteOf } from "../../utils";

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
  const { funktionen } = funktionenOf({ email: email, admin: true, subjekt: await lookUpSubjekt(email) });

  return (
    <FunktionSwitcher
      orte={funktionOrteOf(funktionen)}
      ohneOrt={ADMIN_SHELL_FALLBACK.label}
      mitBereich
    />
  );
}
