"use client";

import { useState } from "react";

import { Callout } from "@/kit/Callout";
import { TextField } from "@/kit/TextField";

import { COPY } from "@/core/copy";
import { asSignInIdentifier } from "@/core/emailAddress";

/** What the start's write asks of its boxes, read on the server, where the schema stays. */
export type StartRules = { required: Readonly<Record<"address" | "email", boolean>>; addressMax: number };

/**
 * The start's boxes: the address on file, its warning as soon as the typed address has a change on the list, since the
 * start ends that one; the new address. Each posts under its name.
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
  const { required, addressMax } = rules;
  return (
    <>
      <TextField
        label={COPY.account.address.current}
        name="address"
        width="W3"
        kind="email"
        autofill="off"
        isRequired={required.address}
        maxLength={addressMax}
        onChange={setTyped}
      />
      {running.includes(asSignInIdentifier(typed)) && (
        <Callout
          tone="warn"
          text={COPY.admin.addressChange.replaces}
        />
      )}
      <TextField
        label={COPY.account.address.new}
        name="email"
        width="W3"
        kind="email"
        autofill="off"
        isRequired={required.email}
        maxLength={addressMax}
      />
    </>
  );
}
