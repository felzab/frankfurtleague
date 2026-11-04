import { redirect } from "next/navigation";

import { AccountPage } from "@/kit/AccountPage";

import { PASSKEY_LIMIT } from "@/core/auth/enrolment";
import { getKontoSession } from "@/core/auth/guards";
import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { requireKontoSubject } from "@/features/konto/account";
import { devicesOf } from "@/features/konto/sicherheit";
import { passkeyStandOf } from "@/features/passkeys/bestand";
import { PASSKEY_NAME_MAX, PasskeyNameSchema } from "@/features/passkeys/schemas";
import { pageMetadata } from "@/shared/utils/metadata";

import { SicherheitBoxes } from "./SicherheitBoxes";

import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.accountSecurity, ROUTES.accountSecurity.path());
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
      limit={stand.canAdd ? undefined : COPY.konto.passkeys.limit(PASSKEY_LIMIT)}
      verwaltung={served.verwaltung}
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
