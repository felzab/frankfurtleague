import { ACCOUNT_COPY } from "@/core/copy/account";
import { COPY } from "@/core/copy/shared";
import { requestErasure, startAddressChange, withdrawAddressChange } from "@/features/account/personActions";
import { AccountBox, AccountSentence } from "@/kit/AccountBox";
import { Callout } from "@/kit/Callout";
import { Facts } from "@/kit/Facts";
import { TextField } from "@/kit/TextField";

import type { Copy } from "@/core/copy";

/** A change pending on the address, as the server words it: its sentence's parts, and its new address. */
export type Pending = {
  readonly parts: { before: Copy; after: Copy };
  readonly email: string;
  /** Said where the step it waits on lapsed. */
  readonly lapsed: boolean;
  /** The person's own change, which this page withdraws; an administrator's the old address's stop link ends. */
  readonly own: boolean;
};

/**
 * Anmeldung's two boxes: the address the person signs in with, its change started, or pending and withdrawn; and
 * „Konto löschen“, the press mailing the link the deletion waits on. `held` says the person holds a passkey, whose
 * touch the start's press asks; `lastOwner` closes the deletion for the league's last owner. Drawn on the server: each
 * box's act is a server action's reference, which a Client Component takes as a prop, and nothing here is a closure.
 */
export function SignInBoxes({
  email,
  pending,
  held,
  lastOwner,
  addressRequired,
}: {
  email: string;
  /** Whether the start's write refuses the new address empty, read off its schema on the server. */
  addressRequired: boolean;
  pending: Pending | null;
  held: boolean;
  lastOwner: Copy | undefined;
}) {
  const address = (
    <Facts
      look="free"
      facts={[{ label: COPY.shared.addressChange.current, value: { record: email, address: true } }]}
    />
  );
  return (
    <>
      {pending === null ? (
        <AccountBox
          title={COPY.shared.emailAddress}
          description={ACCOUNT_COPY.address.description}
          act={{
            run: startAddressChange,
            // The address the page is drawn for, which every act of the account posts.
            carry: { holder: email },
            button: { label: COPY.shared.withObject(COPY.shared.link, "send") },
            touch: held,
          }}>
          {address}
          <TextField
            label={COPY.shared.addressChange.new}
            name="email"
            kind="email"
            autofill="email"
            isRequired={addressRequired}
          />
        </AccountBox>
      ) : (
        <AccountBox
          title={COPY.shared.emailAddress}
          description={ACCOUNT_COPY.address.description}
          act={
            pending.own
              ? {
                  run: withdrawAddressChange,
                  carry: { holder: email },
                  button: { label: COPY.shared.withObject(COPY.shared.addressChange.change, "withdraw") },
                }
              : undefined
          }>
          {address}
          <AccountSentence
            parts={pending.parts}
            record={{ record: pending.email }}
          />
          {pending.lapsed && (
            <Callout
              tone="warn"
              text={ACCOUNT_COPY.address.lapsed}
            />
          )}
        </AccountBox>
      )}
      <AccountBox
        title={COPY.page.accountErasure}
        description={ACCOUNT_COPY.erasure.description}
        act={{
          run: requestErasure,
          carry: { holder: email },
          button: {
            confirm: { verb: "delete", subject: COPY.template.account, consequence: ACCOUNT_COPY.erasure.consequence, tone: "danger" },
          },
          done: COPY.shared.toast.linkSent,
          locked: lastOwner,
        }}
      />
    </>
  );
}
