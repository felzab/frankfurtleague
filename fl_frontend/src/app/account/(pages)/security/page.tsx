import { boxRulesOf } from "@/core/action";
import { PASSKEY_LIMIT } from "@/core/auth/enrolment";
import { ACCOUNT_COPY } from "@/core/copy/account";
import { ROUTES } from "@/core/routes";
import { requireAccountSession } from "@/features/account/account";
import { devicesOf } from "@/features/account/security";
import { heldPasskeysOf } from "@/features/passkeys/held";
import { AccountPage } from "@/kit/AccountPage";
import { pageMetadata } from "@/shared/utils/metadata";

import { renamePasskeyAction } from "./passkeyActs";
import { SecurityBoxes } from "./SecurityBoxes";

import type { HeldPasskeys } from "@/features/passkeys/held";
import type { Passkeys } from "./SecurityBoxes";

export const metadata = pageMetadata(ROUTES.accountSecurity);

/** An administrator's passkey box: the rows, the set-up closed at the cap, and the last row's removal locked. */
const passkeyBoxOf = (held: HeldPasskeys): Passkeys => ({
  rows: held.rows,
  setUpClosed: held.canAdd ? undefined : ACCOUNT_COPY.passkeys.limit(PASSKEY_LIMIT),
  // An administrator's last passkey is their only way into the administration, which the removal refuses.
  lastKept: held.rows.length === 1 ? ACCOUNT_COPY.passkeys.lastKeptLocked : undefined,
});

async function SecurityContent() {
  const { subject, served } = await requireAccountSession(ROUTES.accountSecurity.path());
  // An administrator's alone: no other account holds a passkey, and the enrolment refuses a person's first.
  const [held, devices] = await Promise.all([served.isAdmin ? heldPasskeysOf(served) : undefined, devicesOf(served)]);
  return (
    <SecurityBoxes
      holder={subject.email}
      passkeys={held === undefined ? undefined : passkeyBoxOf(held)}
      devices={ACCOUNT_COPY.devices.description(devices)}
      renameRules={boxRulesOf(renamePasskeyAction)}
    />
  );
}

/** Sicherheit: an administrator's passkeys, and „Alle anderen abmelden“. */
export default function AccountSecurityPage() {
  return (
    <AccountPage route="accountSecurity">
      <SecurityContent />
    </AccountPage>
  );
}
