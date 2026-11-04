import { AccountPage } from "@/kit/AccountPage";

import { getKontoSession } from "@/core/auth/guards";
import { passkeysOf } from "@/core/auth/passkeys";
import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { SignInPayloadSchema } from "@/features/auth/schemas";
import { requireKontoSubject } from "@/features/konto/account";
import { getKontoAdresswechsel, getLoeschungAnsicht } from "@/features/konto/queries";
import { pageMetadata } from "@/shared/utils/metadata";

import { AnmeldungBoxes } from "./AnmeldungBoxes";

import type { FLAccountAddressChangeOpen } from "@/core/generated/client/types";
import type { Metadata, ResolvingMetadata } from "next";
import type { Pending } from "./AnmeldungBoxes";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.accountSignIn, ROUTES.accountSignIn.path());
}

/**
 * Whether the person's own change waits on the address on file's link, which confirms first, rather than on the new
 * address's own: the step the backend serves as `release` on the account's own way.
 */
const waitsOnPrevious = (open: FLAccountAddressChangeOpen): boolean => open.waits_on === "release" && open.way === "account";

/** The change pending on the address, worded on the server, where its deadline is written in the league's time zone. */
function pendingOf(open: FLAccountAddressChangeOpen): Pending {
  const { pending } = COPY.konto.address;
  return {
    parts: { before: pending.before, after: waitsOnPrevious(open) ? pending.previous(open.valid_until) : pending.new(open.valid_until) },
    email: open.email,
    lapsed: open.expired,
    grant: open.approval !== null && !open.approval.approved,
    own: open.way === "account",
  };
}

/** The address and the deletion, read for the session the page is drawn for. */
async function Anmeldung() {
  const subject = await requireKontoSubject();
  const served = await getKontoSession();
  const [change, held, lastOwner] = await Promise.all([
    getKontoAdresswechsel(),
    served === null ? false : passkeysOf(served.user.id).then((rows) => rows.length > 0),
    // Read for an owner alone, the one tier that can be the last; the deletion's own page refuses it again.
    subject.subject.verwaltung === "owner" ? getLoeschungAnsicht().then((view) => view.last_owner) : false,
  ]);
  return (
    <AnmeldungBoxes
      email={subject.email}
      pending={change.open === null ? null : pendingOf(change.open)}
      held={held}
      lastOwner={lastOwner ? SERVER_COPY.refusalLine.last_owner_erasure : undefined}
      addressRequired={!SignInPayloadSchema.shape.email.safeParse("").success}
    />
  );
}

/** Anmeldung: the address the person signs in with, and „Konto löschen“. */
export default function AnmeldungPage() {
  return (
    <AccountPage route="accountSignIn">
      <Anmeldung />
    </AccountPage>
  );
}
