import { TextField } from "@/kit/TextField";

import { requires } from "@/core/action";
import { COPY } from "@/core/copy";
import {
  BanListPostBanListEntryBody,
  banListPostBanListEntryBodyBanReasonMax,
  banListPostBanListEntryBodyEmailMax,
} from "@/core/generated/zod/inputs";
import { SignInPayloadSchema } from "@/features/auth/schemas";

/**
 * The ban dialog's inputs: the address and the Grund, which a mail hands to the address, so it holds no names. Drawn on
 * the server, so the schema never reaches the browser.
 */
export function BanFields() {
  return (
    <>
      <TextField
        label={COPY.signIn.address}
        name="email"
        kind="email"
        autofill="off"
        isRequired={requires(SignInPayloadSchema.shape.email, "")}
        maxLength={banListPostBanListEntryBodyEmailMax}
      />
      <TextField
        label={COPY.admin.spiel.reason}
        name="ban_reason"
        kind="text"
        description={COPY.admin.noNames}
        isRequired={requires(BanListPostBanListEntryBody.shape.ban_reason, "")}
        maxLength={banListPostBanListEntryBodyBanReasonMax}
      />
    </>
  );
}
