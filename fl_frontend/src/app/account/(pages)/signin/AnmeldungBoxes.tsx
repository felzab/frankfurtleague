"use client";

import { AccountBox, AccountSentence } from "@/kit/AccountBox";
import { Callout } from "@/kit/Callout";
import { Facts } from "@/kit/Facts";
import { TextField } from "@/kit/TextField";

import { COPY } from "@/core/copy";
import { approveAddressChange, requestErasure, startAddressChange, withdrawAddressChange } from "@/features/konto/personActions";

import type { Copy } from "@/core/copy";

/** A change pending on the address, as the server words it: its sentence's parts, and its new address. */
export type Pending = {
  readonly parts: { before: Copy; after: Copy };
  readonly email: string;
  /** Said where the step it waits on lapsed. */
  readonly lapsed: boolean;
  /** Said where a grant's move waits on another administrator too. */
  readonly grant: boolean;
  /** The change an administrator started, waiting on this page's approval, by its id: approved rather than withdrawn. */
  readonly approve: string | null;
};

/**
 * Anmeldung's two boxes: the address the person signs in with, its change started, or pending and withdrawn; and
 * „Konto löschen“, the press mailing the link the deletion waits on. `held` says the person holds a passkey, whose
 * touch the start asks first; `lastOwner` closes the deletion for the league's last owner.
 */
export function AnmeldungBoxes({
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
      facts={[{ label: COPY.signIn.address, value: { record: email } }]}
    />
  );
  return (
    <>
      {pending === null ? (
        <AccountBox
          title={COPY.signIn.address}
          description={COPY.konto.address.description}
          act={{ run: startAddressChange, button: { label: COPY.shared.withObject(COPY.konto.address.link, "send") }, touch: held }}>
          {address}
          <TextField
            label={COPY.konto.address.new}
            name="email"
            width="W3"
            kind="email"
            isRequired={addressRequired}
          />
        </AccountBox>
      ) : (
        <AccountBox
          title={COPY.signIn.address}
          description={COPY.konto.address.description}
          act={
            pending.approve === null
              ? { run: withdrawAddressChange, button: { label: COPY.shared.withObject(COPY.konto.address.change, "withdraw") } }
              : {
                  run: (formData) => {
                    formData.set("id", pending.approve ?? "");
                    return approveAddressChange(formData);
                  },
                  button: { label: COPY.shared.withObject(COPY.konto.address.change, "confirm") },
                  touch: held,
                }
          }>
          {address}
          <AccountSentence
            parts={pending.parts}
            record={{ record: pending.email }}
          />
          {pending.lapsed && (
            <Callout
              tone="warn"
              text={COPY.konto.address.lapsed}
            />
          )}
          {pending.grant && (
            <Callout
              tone="info"
              text={COPY.konto.address.grantNote}
            />
          )}
        </AccountBox>
      )}
      <AccountBox
        title={COPY.page.accountErasure}
        description={COPY.konto.erasure.description}
        act={{
          run: requestErasure,
          button: { confirm: { verb: "delete", subject: COPY.template.account, consequence: COPY.konto.erasure.consequence, tone: "danger" } },
          done: COPY.shared.toast.linkSent,
          closed: lastOwner,
        }}
      />
    </>
  );
}
