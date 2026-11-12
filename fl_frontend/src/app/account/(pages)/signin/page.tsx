import { AccountBoxPlaceholder } from "@/kit/AccountBox";
import { AccountPage } from "@/kit/AccountPage";
import { CalloutPlaceholder } from "@/kit/Callout";
import { EMAIL_WORDS, FactsPlaceholder } from "@/kit/Facts";
import { FieldPlaceholder } from "@/kit/FieldPair";

import { requires } from "@/core/action";
import { HOLDER_WAIT } from "@/core/addressChange";
import { passkeysOf } from "@/core/auth/passkeys";
import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { getSubjectSession } from "@/core/subject";
import { requireAccountSession } from "@/features/account/account";
import { getAccountAddressChange } from "@/features/account/queries";
import { SignInPayloadSchema } from "@/features/auth/schemas";
import { pageMetadata } from "@/shared/utils/metadata";

import { SignInBoxes } from "./SignInBoxes";

import type { FLAccountAddressChangeOpen, FLAdminTier } from "@/core/generated/client/types";
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
      holderWait={change.wait_tier === null ? undefined : COPY.account.address.holderWait(HOLDER_WAIT[change.wait_tier])}
      lastOwner={subject.records.admin_tier === "owner" ? COPY.account.erasure.ownerLocked : undefined}
      addressRequired={requires(SignInPayloadSchema.shape.email, "")}
    />
  );
}

/** The page's two boxes while they are read, as they stand with no change running, a holder's sentence under the field. */
function SignInWait({ tier }: { tier: FLAdminTier | null }) {
  return (
    <>
      <AccountBoxPlaceholder
        description={COPY.account.address.description}
        foot={COPY.shared.withObject(COPY.account.address.link, "send")}>
        <FactsPlaceholder
          pairs={1}
          look="free"
          wraps={{ pair: 0, words: EMAIL_WORDS }}
        />
        <FieldPlaceholder />
        {tier !== null && <CalloutPlaceholder text={COPY.account.address.holderWait(HOLDER_WAIT[tier])} />}
      </AccountBoxPlaceholder>
      <AccountBoxPlaceholder
        description={COPY.account.erasure.description}
        foot={COPY.shared.withObject(COPY.template.account, "delete")}
        danger
      />
    </>
  );
}

/** The wait as the tier shapes it: the session's own lookup, which runs ahead of the change's read. */
async function waitOfTier() {
  const subject = await getSubjectSession();
  return <SignInWait tier={subject?.records.admin_tier ?? null} />;
}

/** Anmeldung: the address the person signs in with, and „Konto löschen“. */
export default function AccountSignInPage() {
  return (
    <AccountPage
      route="accountSignIn"
      wait={<SignInWait tier={null} />}
      waitOnceRead={waitOfTier()}>
      <SignInContent />
    </AccountPage>
  );
}
