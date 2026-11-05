import { AccountPage } from "@/kit/AccountPage";

import { PASSKEY_LIMIT } from "@/core/auth/enrolment";
import { isFreshForEnrolment, PASSKEY_FACTOR } from "@/core/auth/sessionStamps";
import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { requireAccountSession } from "@/features/konto/account";
import { devicesOf } from "@/features/konto/security";
import { heldPasskeysOf } from "@/features/passkeys/held";
import { PASSKEY_NAME_MAX, PasskeyNameSchema } from "@/features/passkeys/schemas";
import { pageMetadata } from "@/shared/utils/metadata";

import { SecurityBoxes } from "./SecurityBoxes";

import type { Copy } from "@/core/copy";
import type { HeldPasskeys } from "@/features/passkeys/held";
import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.accountSecurity, ROUTES.accountSecurity.path());
}

/**
 * Why the set-up is closed, where the page knows it at render: the cap, or a first passkey asked of a code session
 * older than the library's `freshAge`, which refuses it. A session the passkey made is fresh by the touch the set-up
 * asks first.
 */
function setUpClosedOf(
  served: { readonly session: { readonly createdAt: Date | string; readonly authFactor?: unknown } },
  stand: HeldPasskeys,
): Copy | undefined {
  if (!stand.canAdd) return COPY.account.passkeys.limit(PASSKEY_LIMIT);
  if (stand.rows.length > 0 || served.session.authFactor === PASSKEY_FACTOR) return undefined;
  return isFreshForEnrolment(served.session) ? undefined : COPY.account.passkeys.signInTooOld;
}

/** The passkeys and the devices, read for the session the page is drawn for. */
async function SecurityContent() {
  const { subject, served } = await requireAccountSession(ROUTES.accountSecurity.path());
  const [stand, devices] = await Promise.all([heldPasskeysOf(served), devicesOf(served)]);
  return (
    <SecurityBoxes
      holder={subject.email}
      passkeys={stand.rows}
      setUpClosed={setUpClosedOf(served, stand)}
      // An administrator's last passkey is their only way into the administration, which the removal refuses.
      lastKept={served.admin && stand.rows.length === 1 ? COPY.account.passkeys.lastKept : undefined}
      devices={COPY.account.devices.description(devices)}
      name={{ required: !PasskeyNameSchema.safeParse("").success, max: PASSKEY_NAME_MAX }}
    />
  );
}

/** Sicherheit: the passkeys, and „Alle anderen abmelden“. */
export default function AccountSecurityPage() {
  return (
    <AccountPage route="accountSecurity">
      <SecurityContent />
    </AccountPage>
  );
}
