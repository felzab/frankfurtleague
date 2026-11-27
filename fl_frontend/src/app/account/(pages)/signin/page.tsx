import { boxRulesOf } from "@/core/action";
import { ACCOUNT_COPY } from "@/core/copy/account";
import { COPY } from "@/core/copy/shared";
import { ROUTES } from "@/core/routes";
import { requireAccountSession } from "@/features/account/account";
import { startAddressChange } from "@/features/account/personActions";
import { getAccountAddressChange } from "@/features/account/queries";
import { AccountPage } from "@/kit/AccountPage";
import { pageMetadata } from "@/shared/utils/metadata";

import { SignInBoxes } from "./SignInBoxes";

import type { FLAccountAddressChangeOpen } from "@/core/generated/client/types";
import type { Pending } from "./SignInBoxes";

export const metadata = pageMetadata(ROUTES.accountSignIn);

/** The change pending on the address, worded on the server, where its deadline is written in the league's time zone. */
function pendingOf(open: FLAccountAddressChangeOpen): Pending {
  const { pending } = ACCOUNT_COPY.address;
  const address = { record: open.email };
  // The person's own change asks the address on file's link first, then the new address's own; a holder's then waits.
  const sentence = {
    previous_address: pending.previous(address, open.valid_until),
    new_address: pending.new(address, open.valid_until),
    waiting_period: open.effective_from === null ? pending.new(address, null) : pending.waiting(address, open.effective_from),
  }[open.waits_on];
  return {
    sentence,
    lapsed: open.expired,
    own: open.way === "account",
  };
}

async function SignInContent() {
  const { subject, served } = await requireAccountSession(ROUTES.accountSignIn.path());
  const change = await getAccountAddressChange();
  return (
    <SignInBoxes
      email={subject.email}
      pending={change.open === null ? null : pendingOf(change.open)}
      touch={served.isAdmin}
      lastOwner={subject.records.admin_tier === "owner" ? COPY.shared.afterHandover : undefined}
      addressRules={boxRulesOf(startAddressChange)}
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
