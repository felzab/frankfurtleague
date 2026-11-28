import { ACCOUNT_COPY } from "@/core/copy/account";
import { COPY } from "@/core/copy/shared";
import { requestErasure, startAddressChange, withdrawAddressChange } from "@/features/account/personActions";
import { AccountBox, AccountSentence } from "@/kit/AccountBox";
import { Callout } from "@/kit/Callout";
import { Facts } from "@/kit/Facts";
import { TextField } from "@/kit/TextField";

import type { BoxRules } from "@/core/boxRules";
import type { Copy, RecordText } from "@/core/copy";

/** A change pending on the address, as the server words it: its sentence's runs, around its new address. */
export type Pending = {
  readonly sentence: readonly [Copy, RecordText, Copy];
  /** Said where the step it waits on lapsed. */
  readonly lapsed: boolean;
  /** The person's own change, which this page withdraws; an administrator's the old address's stop link ends. */
  readonly own: boolean;
};

/**
 * Anmeldung's two boxes: the address the person signs in with, its change started, or pending and withdrawn; and
 * „Konto löschen“, the press mailing the link the deletion waits on. `touch` says the page is an administrator's, whose
 * passkey touch the start's press asks; `lastOwner` closes the deletion for the league's last owner. Drawn on the server: each
 * box's act is a server action's reference, which a Client Component takes as a prop, and nothing here is a closure.
 */
export function SignInBoxes({
  email,
  pending,
  touch,
  lastOwner,
  addressRules,
}: {
  email: string;
  /** What the change's start asks of the new address, read on the server. */
  addressRules: BoxRules;
  pending: Pending | null;
  touch: boolean;
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
            dryRun: true,
            rules: addressRules,
            // The address the page is drawn for, which every act of the account posts.
            carry: { holder: email },
            button: { label: COPY.shared.withObject(COPY.shared.link, "send") },
            done: COPY.shared.toast.linkSent,
            ...(touch ? { touch: { holder: email } } : {}),
          }}>
          {address}
          <TextField
            label={COPY.shared.addressChange.new}
            name="email"
            kind="email"
            autofill="email"
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
                  done: COPY.shared.toast.done.withdraw,
                }
              : undefined
          }>
          {address}
          <AccountSentence sentence={pending.sentence} />
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
