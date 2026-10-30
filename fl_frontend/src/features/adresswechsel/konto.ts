import { accountStandsAt } from "@/core/auth";

import { postAdresswechselAdresse } from "./mutations";

import type { FLAdresswechselAdressePayload } from "@/core/generated/client/types";

/**
 * Whether a sign-in account already stands at the new address of the live change the key names, which refuses the
 * change. The address stays inside this call: no caller, page or log line is handed it.
 */
export async function kontoAnNeuerAdresse(schluessel: FLAdresswechselAdressePayload): Promise<boolean> {
  const { email } = await postAdresswechselAdresse(schluessel);
  return email !== null && (await accountStandsAt(email));
}
