"use client";

import { useState } from "react";

import { Facts } from "@/kit/Facts";
import { Select } from "@/kit/Select";

import { now } from "@/core/clock";
import { COPY } from "@/core/copy";
import { formatInstantShort } from "@/core/format";

import type { FLOwnerWaitDays } from "@/core/generated/client/types";
import type { Option } from "@/kit/OptionList";

const WORDS = COPY.admin;

const OWNER_WAIT = { days: 7 } as const satisfies { days: FLOwnerWaitDays };

const DAY_MS = 86_400_000;

/**
 * The handover's select of current administrators and its facts. The date is read as the dialog opens, for a page may
 * stand open for hours before the press that sets it, and this component mounts only then, so it meets no hydration.
 */
export function HandoverFields({
  owner,
  administrators,
  isRequired,
}: {
  owner: string;
  administrators: readonly Option[];
  isRequired: boolean;
}) {
  const [from] = useState(() => new Date(now().getTime() + OWNER_WAIT.days * DAY_MS));
  return (
    <>
      <Select
        label={WORDS.facts.after}
        name="grant_id"
        options={administrators}
        isRequired={isRequired}
        description={WORDS.administrators.handoverConsequence(OWNER_WAIT)}
      />
      <Facts
        facts={[
          { label: WORDS.facts.before, value: { record: owner } },
          { label: WORDS.facts.effectiveFrom, value: { record: formatInstantShort(from) } },
          { label: WORDS.facts.mailTo, value: WORDS.mailTo.holders },
        ]}
      />
    </>
  );
}
