import { requires } from "@/core/action";
import { COPY } from "@/core/copy";
import {
  BanListPostBanListEntryBody,
  banListPostBanListEntryBodyBanReasonMax,
  banListPostBanListEntryBodyEmailMax,
} from "@/core/generated/zod/inputs";
import { SignInPayloadSchema } from "@/features/auth/schemas";
import { TextField } from "@/kit/TextField";

/**
 * The ban dialog's inputs: the address and the Grund, which a mail hands to the address, so it holds no names. Drawn on
 * the server, so the schema never reaches the browser.
 */
export function BanFields() {
  return (
    <>
      <TextField
        label={COPY.shared.emailAddress}
        name="email"
        kind="email"
        isRequired={requires(SignInPayloadSchema.shape.email, "")}
        maxLength={banListPostBanListEntryBodyEmailMax}
      />
      <TextField
        label={COPY.shared.reason}
        name="ban_reason"
        kind="text"
        description={COPY.shared.noNames}
        isRequired={requires(BanListPostBanListEntryBody.shape.ban_reason, "")}
        maxLength={banListPostBanListEntryBodyBanReasonMax}
      />
    </>
  );
}
