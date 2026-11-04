import { redirect } from "next/navigation";

import { AccountPage } from "@/kit/AccountPage";

import { PASSKEY_LIMIT } from "@/core/auth/enrolment";
import { getKontoSession } from "@/core/auth/guards";
import { FRESH_SIGN_IN_SECONDS, PASSKEY_FACTOR } from "@/core/auth/sessionStamps";
import { now } from "@/core/clock";
import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { requireKontoSubject } from "@/features/konto/account";
import { devicesOf } from "@/features/konto/sicherheit";
import { passkeyStandOf } from "@/features/passkeys/bestand";
import { PASSKEY_NAME_MAX, PasskeyNameSchema } from "@/features/passkeys/schemas";
import { pageMetadata } from "@/shared/utils/metadata";

import { SicherheitBoxes } from "./SicherheitBoxes";

import type { Copy } from "@/core/copy";
import type { PasskeyStand } from "@/features/passkeys/bestand";
import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.accountSecurity, ROUTES.accountSecurity.path());
}

/**
 * Why the set-up is closed, where the page knows it at render: the cap, or a first passkey asked of a code session
 * older than the library's `freshAge`, which refuses it (`fl_frontend/src/core/auth/landing.ts` judges the same for
 * the landing's card). A session the passkey made is fresh by the touch the set-up asks first.
 */
function setUpClosedOf(
  served: { readonly session: { readonly createdAt: Date | string; readonly authFactor?: unknown } },
  stand: PasskeyStand,
): Copy | undefined {
  if (!stand.canAdd) return COPY.konto.passkeys.limit(PASSKEY_LIMIT);
  if (stand.rows.length > 0 || served.session.authFactor === PASSKEY_FACTOR) return undefined;
  const created = new Date(served.session.createdAt).getTime();
  const mayEnrol = Number.isFinite(created) && now().getTime() - created < FRESH_SIGN_IN_SECONDS * 1000;
  return mayEnrol ? undefined : COPY.konto.passkeys.signInTooOld;
}

/** The passkeys and the devices, read for the session the page is drawn for. */
async function Sicherheit() {
  await requireKontoSubject();
  // The account page's own verdict on the session, which holds an administrator's address to the administrator's lane.
  const served = await getKontoSession();
  if (served === null) redirect(ROUTES.signIn.path());
  const [stand, devices] = await Promise.all([passkeyStandOf(served), devicesOf(served)]);
  return (
    <SicherheitBoxes
      passkeys={stand.rows}
      setUpClosed={setUpClosedOf(served, stand)}
      // An administrator's last passkey is their only way into the administration, which the removal refuses.
      lastKept={served.verwaltung && stand.rows.length === 1 ? COPY.konto.passkeys.lastKept : undefined}
      devices={COPY.konto.devices.description(devices)}
      name={{ required: !PasskeyNameSchema.safeParse("").success, max: PASSKEY_NAME_MAX }}
    />
  );
}

/** Sicherheit: the passkeys, and „Alle anderen abmelden“. */
export default function SicherheitPage() {
  return (
    <AccountPage route="accountSecurity">
      <Sicherheit />
    </AccountPage>
  );
}
