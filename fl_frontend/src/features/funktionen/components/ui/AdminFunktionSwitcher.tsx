import { connection } from "next/server";

import { getAdminSession } from "@/core/auth";
import { asSignInIdentifier } from "@/core/emailAddress";
import { funktionenOf } from "@/core/funktionen";
import { lookUpSubjekt } from "@/core/signInGate";
import { ADMIN_SHELL_FALLBACK } from "@/features/admin/constants";
import { FunktionSwitcher } from "@/shared/components/layout/sidemenu/FunktionSwitcher";

import { funktionOrteOf } from "../../utils";

/**
 * The administrator's switcher: the records of the admin session's own address, never through
 * `getSubjectSession`, the person lane's read, which reads the sign-in again and sets a second actor
 * (`docs/frontend/spec.md :: I394`).
 */
export async function AdminFunktionSwitcher() {
  // Its own, whatever is mounted above: the builder stage reaches no sign-in store (`docs/frontend/spec.md :: I448`).
  await connection();
  // The hold's own read, memoised per render; nothing for a refused session, the page turning it away
  // (`docs/frontend/spec.md :: I834`).
  const served = await getAdminSession();
  if (served === null) return null;

  const email = asSignInIdentifier(served.user.email);

  // The lookup the session's verdict was read from, memoised per render: a lookup failing here failed
  // there first, and the verdict answered it with no session.
  const subjekt = await lookUpSubjekt(email);

  const { funktionen } = funktionenOf({ email: email, admin: true, subjekt: subjekt });

  return (
    <FunktionSwitcher
      orte={funktionOrteOf(funktionen)}
      ohneOrt={ADMIN_SHELL_FALLBACK.label}
      mitBereich
    />
  );
}
