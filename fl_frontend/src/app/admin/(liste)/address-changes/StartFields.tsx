"use client";

import { useState } from "react";

import { Callout } from "@/kit/Callout";
import { Facts } from "@/kit/Facts";
import { TextField } from "@/kit/TextField";

import { ADDRESS_CHANGE_WAIT_DAYS } from "@/core/addressChange";
import { COPY } from "@/core/copy";
import { asSignInIdentifier } from "@/core/emailAddress";

const WORDS = COPY.admin.addressChange;

/** What the start's write asks of its boxes, read on the server, where the schema stays. */
export type StartRules = { required: Readonly<Record<"address" | "email" | "change_reason", boolean>>; reasonMax: number; addressMax: number };

/**
 * The start's boxes: the address on file, its warning as soon as the typed address has a change on the list, since the
 * start ends that one; the new address; the reason, one line, and what the start sets off. Each posts under its name.
 */
export function StartFields({
  running,
  rules,
}: {
  /** The addresses the list holds a change for, as the server stores them. */
  running: readonly string[];
  rules: StartRules;
}) {
  const [typed, setTyped] = useState("");
  const { required, reasonMax, addressMax } = rules;
  return (
    <>
      <TextField
        label={COPY.account.address.current}
        name="address"
        width="W3"
        kind="email"
        isRequired={required.address}
        maxLength={addressMax}
        onChange={setTyped}
      />
      {running.includes(asSignInIdentifier(typed)) && (
        <div className="w-full">
          <Callout
            tone="warn"
            text={WORDS.replaces}
          />
        </div>
      )}
      <TextField
        label={COPY.account.address.new}
        name="email"
        width="W3"
        kind="email"
        isRequired={required.email}
        maxLength={addressMax}
      />
      <TextField
        label={COPY.admin.spiel.reason}
        name="change_reason"
        width="W3L"
        kind="text"
        description={COPY.admin.noNames}
        isRequired={required.change_reason}
        maxLength={reasonMax}
      />
      <p className="text-sm text-fg-muted">{WORDS.startConsequence({ days: ADDRESS_CHANGE_WAIT_DAYS })}</p>
      <div className="w-full">
        <Facts facts={[{ label: COPY.admin.facts.mailTo, value: COPY.admin.mailTo.bothAddresses }]} />
      </div>
    </>
  );
}
