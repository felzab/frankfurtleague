import { AccountPage } from "@/kit/AccountPage";

import { passkeysOf } from "@/core/auth/passkeys";
import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { SignInPayloadSchema } from "@/features/auth/schemas";
import { requireAccountSession } from "@/features/konto/account";
import { getKontoAdresswechsel, getLoeschungAnsicht } from "@/features/konto/queries";
import { pageMetadata } from "@/shared/utils/metadata";

import { SignInBoxes } from "./SignInBoxes";

import type { FLAccountAddressChangeOpen } from "@/core/generated/client/types";
import type { Metadata, ResolvingMetadata } from "next";
import type { Pending } from "./SignInBoxes";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.accountSignIn, ROUTES.accountSignIn.path());
}

/** The change pending on the address, worded on the server, where its deadline is written in the league's time zone. */
function pendingOf(open: FLAccountAddressChangeOpen): Pending {
  const { pending } = COPY.konto.address;
  // The person's own change asks the address on file's link first, then the new address's own.
  const previous = open.waits_on === "previous_address";
  return {
    parts: { before: pending.before, after: previous ? pending.previous(open.valid_until) : pending.new(open.valid_until) },
    email: open.email,
    lapsed: open.expired,
    grant: open.approval !== null && !open.approval.approved,
    own: open.way === "account",
  };
}

/** The address and the deletion, read for the session the page is drawn for. */
async function SignInContent() {
  const { subject, served } = await requireAccountSession(ROUTES.accountSignIn.path());
  const [change, held, lastOwner] = await Promise.all([
    getKontoAdresswechsel(),
    passkeysOf(served.user.id).then((rows) => rows.length > 0),
    // Read for an owner alone, the one tier that can be the last; the deletion's own page refuses it again.
    subject.subject.verwaltung === "owner" ? getLoeschungAnsicht().then((view) => view.last_owner) : false,
  ]);
  return (
    <SignInBoxes
      email={subject.email}
      pending={change.open === null ? null : pendingOf(change.open)}
      held={held}
      lastOwner={lastOwner ? SERVER_COPY.refusalLine.last_owner_erasure : undefined}
      addressRequired={!SignInPayloadSchema.shape.email.safeParse("").success}
    />
  );
}

/** Anmeldung: the address the person signs in with, and „Konto löschen“. */
export default function AccountSignInPage() {
  return (
    <AccountPage route="accountSignIn">
      <SignInContent />
    </AccountPage>
  );
}
