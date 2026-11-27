import { COPY } from "@/core/copy/shared";
import { TextField } from "@/kit/TextField";

/**
 * The ban dialog's inputs: the address and the Grund, which a mail hands to the address, so it holds no names.
 */
export function BanFields() {
  return (
    <>
      <TextField
        label={COPY.shared.emailAddress}
        name="email"
        kind="email"
      />
      <TextField
        label={COPY.shared.reason}
        name="ban_reason"
        kind="text"
        description={COPY.shared.noNames}
      />
    </>
  );
}
