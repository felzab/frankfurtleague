import "client-only";

import { appToast } from "./appToast";
import { versandGrad } from "./linkVersand";

import type { LinkVersand, VersandGrad } from "./linkVersand";

/**
 * A press's title for each way its link ended. **No title here is a press's failure title**, which
 * `appToast.failure` raises at another variant (`docs/frontend/spec.md :: I42`).
 */
export type VersandTitel = Readonly<Record<VersandGrad, string>>;

export const BESTAETIGUNGSLINK_TITEL: VersandTitel = {
  gesendet: "Bestätigungslink gesendet",
  fehlgeschlagen: "Bestätigungslink nicht verschickt",
  abgelegt: "Bestätigungslink zurückgehalten",
};

/** A team's registration link, its own press and a season's press reaching one team alike. */
export const REGISTRIERUNGSLINK_TITEL: VersandTitel = {
  gesendet: "Registrierungslink gesendet",
  fehlgeschlagen: "Registrierungslink nicht verschickt",
  abgelegt: "Registrierungslink zurückgehalten",
};

export const LINK_TITEL: VersandTitel = {
  gesendet: "Link gesendet",
  fehlgeschlagen: "Link nicht verschickt",
  abgelegt: "Link zurückgehalten",
};

/** The toast of a write that landed and sent a link: a success only where the link went out (`docs/frontend/spec.md :: I725`). */
export function meldeLinkVersand(versand: LinkVersand, titel: VersandTitel, description: string): void {
  const grad = versandGrad(versand);
  const raise = grad === "gesendet" ? appToast.success : appToast.warning;

  raise(titel[grad], { description });
}
