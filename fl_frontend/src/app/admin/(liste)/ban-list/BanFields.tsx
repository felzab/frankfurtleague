import { Facts } from "@/kit/Facts";
import { TextField } from "@/kit/TextField";

import { requires } from "@/core/action";
import { COPY } from "@/core/copy";
import {
  BanListPostBanListEntryBody,
  banListPostBanListEntryBodyBanReasonMax,
  banListPostBanListEntryBodyEmailMax,
} from "@/core/generated/zod/inputs";
import { SignInPayloadSchema } from "@/features/auth/schemas";

import type { FLBanDurationSaisons } from "@/core/generated/client/types";

const WORDS = COPY.admin.banList;

/**
 * How many seasons a ban runs, which the dialog states ahead of the act; checked against the bound
 * `fl_backend/app/shared/schemas/bounds.py :: BAN_DURATION_SAISONS` publishes, so the backend moving it fails the type
 * check here.
 */
const BAN_SAISONS = 5 satisfies FLBanDurationSaisons;

/**
 * The ban dialog's inputs and how long the ban runs: the address and the Grund, which a mail hands to the address, so
 * it holds no names. Drawn on the server, so the schema never reaches the browser.
 */
export function BanFields() {
  return (
    <>
      <TextField
        label={COPY.signIn.address}
        name="email"
        width="W3"
        kind="email"
        isRequired={requires(SignInPayloadSchema.shape.email, "")}
        maxLength={banListPostBanListEntryBodyEmailMax}
      />
      <TextField
        label={COPY.admin.spiel.reason}
        name="ban_reason"
        width="W3"
        kind="text"
        description={COPY.admin.noNames}
        isRequired={requires(BanListPostBanListEntryBody.shape.ban_reason, "")}
        maxLength={banListPostBanListEntryBodyBanReasonMax}
      />
      <Facts facts={[{ label: WORDS.duration, value: WORDS.durationSaisons(BAN_SAISONS) }]} />
    </>
  );
}
