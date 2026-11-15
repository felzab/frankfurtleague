import { AccountPage } from "@/kit/AccountPage";

import { requires } from "@/core/action";
import { passkeysOf } from "@/core/auth/passkeys";
import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { requireAccountSession } from "@/features/account/account";
import { getAccountAddressChange } from "@/features/account/queries";
import { SignInPayloadSchema } from "@/features/auth/schemas";
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
  const { pending } = COPY.account.address;
  // The person's own change asks the address on file's link first, then the new address's own; a holder's then waits.
  const after = {
    previous_address: pending.previous(open.valid_until),
    new_address: pending.new(open.valid_until),
    waiting_period: open.effective_from === null ? pending.new(null) : pending.waiting(open.effective_from),
  }[open.waits_on];
  return {
    parts: { before: pending.before, after },
    email: open.email,
    lapsed: open.expired,
    own: open.way === "account",
  };
}

/** The address and the deletion, read for the session the page is drawn for. */
async function SignInContent() {
  const { subject, served } = await requireAccountSession(ROUTES.accountSignIn.path());
  const [change, held] = await Promise.all([getAccountAddressChange(), passkeysOf(served.user.id).then((rows) => rows.length > 0)]);
  return (
    <SignInBoxes
      email={subject.email}
      pending={change.open === null ? null : pendingOf(change.open)}
      held={held}
      lastOwner={subject.records.admin_tier === "owner" ? COPY.account.erasure.ownerLocked : undefined}
      addressRequired={requires(SignInPayloadSchema.shape.email, "")}
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
