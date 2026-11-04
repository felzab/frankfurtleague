import { AccountPage } from "@/kit/AccountPage";

import { PASSKEY_LIMIT } from "@/core/auth/enrolment";
import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { requireAccountSession } from "@/features/konto/account";
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
  const { subject, served } = await requireAccountSession(ROUTES.accountSecurity.path());
  const [stand, devices] = await Promise.all([passkeyStandOf(served), devicesOf(served)]);
  return (
    <SicherheitBoxes
      holder={subject.email}
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
