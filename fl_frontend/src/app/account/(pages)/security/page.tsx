import { AccountBoxPlaceholder } from "@/kit/AccountBox";
import { AccountPage } from "@/kit/AccountPage";

import { requires } from "@/core/action";
import { PASSKEY_LIMIT } from "@/core/auth/enrolment";
import { getAccountSession } from "@/core/auth/guards";
import { isFreshForEnrolment, PASSKEY_FACTOR } from "@/core/auth/sessionStamps";
import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { requireAccountSession } from "@/features/account/account";
import { devicesOf } from "@/features/account/security";
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
 * asks.
 */
function setUpClosedOf(
  served: { readonly session: { readonly createdAt: Date | string; readonly authFactor?: unknown } },
  stand: HeldPasskeys,
): Copy | undefined {
  if (!stand.canAdd) return COPY.account.passkeys.limit(PASSKEY_LIMIT);
  if (stand.rows.length > 0 || served.session.authFactor === PASSKEY_FACTOR) return undefined;
  return isFreshForEnrolment(served.session) ? undefined : COPY.account.passkeys.signInTooOldLocked;
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
      lastKept={served.isAdmin && stand.rows.length === 1 ? COPY.account.passkeys.lastKeptLocked : undefined}
      devices={COPY.account.devices.description(devices)}
      name={{ required: requires(PasskeyNameSchema, ""), max: PASSKEY_NAME_MAX }}
    />
  );
}

/** The page's two boxes while they are read, the passkeys' holding `rows` of them, the devices' one device. */
function SecurityWait({ rows }: { rows: number }) {
  return (
    <>
      <AccountBoxPlaceholder
        description={COPY.account.passkeys.description}
        rows={rows}
        foot={COPY.shared.withObject(COPY.signIn.passkeyTitle, "setUp")}
      />
      <AccountBoxPlaceholder
        description={COPY.account.devices.description(1)}
        foot={COPY.shared.withObject(COPY.account.devices.allOthers, "signOut")}
      />
    </>
  );
}

/**
 * The wait as the session's sign-in shapes it, from the lookup the page's own read shares: a passkey's sign-in holds
 * the passkey that made it, and a code's commonly holds none: a person holding one signs in with it, and one holding
 * none is offered a set-up at every code sign-in.
 */
async function waitOfFactor() {
  const served = await getAccountSession();
  return <SecurityWait rows={served?.session.authFactor === PASSKEY_FACTOR ? 1 : 0} />;
}

/**
 * Sicherheit: the passkeys, and „Alle anderen abmelden“. Before any read the wait holds a passkey's row, the taller
 * form, which a rail page's wait draws where the read decides.
 */
export default function AccountSecurityPage() {
  return (
    <AccountPage
      route="accountSecurity"
      wait={<SecurityWait rows={1} />}
      waitOnceRead={waitOfFactor()}>
      <SecurityContent />
    </AccountPage>
  );
}
