import { requires } from "@/core/action";
import { PASSKEY_LIMIT } from "@/core/auth/enrolment";
import { isFreshForEnrolment, PASSKEY_FACTOR } from "@/core/auth/sessionStamps";
import { ACCOUNT_COPY } from "@/core/copy/account";
import { ROUTES } from "@/core/routes";
import { requireAccountSession } from "@/features/account/account";
import { devicesOf } from "@/features/account/security";
import { heldPasskeysOf } from "@/features/passkeys/held";
import { PASSKEY_NAME_MAX, PasskeyNameSchema } from "@/features/passkeys/schemas";
import { AccountPage } from "@/kit/AccountPage";
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
 * asks.
 */
function setUpClosedOf(
  served: { readonly session: { readonly createdAt: Date | string; readonly authFactor?: unknown } },
  held: HeldPasskeys,
): Copy | undefined {
  if (!held.canAdd) return ACCOUNT_COPY.passkeys.limit(PASSKEY_LIMIT);
  if (held.rows.length > 0 || served.session.authFactor === PASSKEY_FACTOR) return undefined;
  return isFreshForEnrolment(served.session) ? undefined : ACCOUNT_COPY.passkeys.signInTooOldLocked;
}

async function SecurityContent() {
  const { subject, served } = await requireAccountSession(ROUTES.accountSecurity.path());
  const [held, devices] = await Promise.all([heldPasskeysOf(served), devicesOf(served)]);
  return (
    <SecurityBoxes
      holder={subject.email}
      passkeys={held.rows}
      // An administrator's alone: a person's first passkey would outrank their mailbox for good, and the enrolment
      // refuses it. A person keeps the passkeys they hold, each with its removal.
      setUp={served.isAdmin ? { closed: setUpClosedOf(served, held) } : undefined}
      // An administrator's last passkey is their only way into the administration, which the removal refuses.
      lastKept={served.isAdmin && held.rows.length === 1 ? ACCOUNT_COPY.passkeys.lastKeptLocked : undefined}
      devices={ACCOUNT_COPY.devices.description(devices)}
      name={{ required: requires(PasskeyNameSchema, ""), max: PASSKEY_NAME_MAX }}
    />
  );
}

/** Sicherheit: an administrator's passkeys or those a person holds, and „Alle anderen abmelden“. */
export default function AccountSecurityPage() {
  return (
    <AccountPage route="accountSecurity">
      <SecurityContent />
    </AccountPage>
  );
}
