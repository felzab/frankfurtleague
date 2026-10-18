import "client-only";

import { appToast } from "./appToast";
import { hinweisFehlt, versandGrad } from "./linkVersand";

import type { HinweisVersand, LinkVersand, VersandGrad } from "./linkVersand";

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

/** An address change's titles where its notice to the stored address failed, the body asking the administrator to tell the person. */
const LINK_OHNE_HINWEIS_TITEL: VersandTitel = {
  gesendet: "Link gesendet, Hinweis nicht verschickt",
  fehlgeschlagen: "Link und Hinweis nicht verschickt",
  abgelegt: "Link zurückgehalten, Hinweis nicht verschickt",
};

/** An address change's titles where its notice to the stored address may have gone or not, the body asking the same. */
const LINK_HINWEIS_UNKLAR_TITEL: VersandTitel = {
  gesendet: "Link gesendet, Hinweis unklar",
  fehlgeschlagen: "Link nicht verschickt, Hinweis unklar",
  abgelegt: "Link zurückgehalten, Hinweis unklar",
};

/** An address change's toast: its link's, and a warning titled for the notice too where that failed or may have (`docs/frontend/spec.md :: I679`). */
export function meldeAdresswechselVersand(
  { versand, hinweis }: { versand: LinkVersand; hinweis?: HinweisVersand | null },
  description: string,
): void {
  const titel = hinweis === "ungewiss" ? LINK_HINWEIS_UNKLAR_TITEL : LINK_OHNE_HINWEIS_TITEL;

  if (hinweisFehlt(hinweis)) appToast.warning(titel[versandGrad(versand)], { description });
  else meldeLinkVersand(versand, LINK_TITEL, description);
}

/** The toast of a write that landed and sent a link: a success only where the link went out (`docs/frontend/spec.md :: I725`). */
export function meldeLinkVersand(versand: LinkVersand, titel: VersandTitel, description: string): void {
  const grad = versandGrad(versand);
  const raise = grad === "gesendet" ? appToast.success : appToast.warning;

  raise(titel[grad], { description });
}
