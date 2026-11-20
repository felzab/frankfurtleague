"use client";

import { useState } from "react";

import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { asSignInIdentifier } from "@/core/emailAddress";
import { Callout } from "@/kit/Callout";
import { TextField } from "@/kit/TextField";

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
        label={COPY.shared.addressChange.current}
        name="address"
        kind="email"
        isRequired={required.address}
        maxLength={addressMax}
        onChange={setTyped}
      />
      {running.includes(asSignInIdentifier(typed)) && (
        <Callout
          tone="warn"
          text={ADMIN_COPY.addressChange.replaces}
        />
      )}
      <TextField
        label={COPY.shared.addressChange.new}
        name="email"
        kind="email"
        isRequired={required.email}
        maxLength={addressMax}
      />
    </>
  );
}
