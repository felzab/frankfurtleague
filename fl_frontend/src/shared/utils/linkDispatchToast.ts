import "client-only";

import { appToast } from "./appToast";

/** How one link mail ended for the press that sent it: handed on to be mailed, or not. */
type LinkDispatch = "gesendet" | "fehlgeschlagen";

/**
 * A press's title for each way its link ended. **No title here is a press's failure title**, which
 * `appToast.failure` raises at another variant.
 */
export type DispatchTitel = Readonly<Record<LinkDispatch, string>>;

/** A team's registration link, its own press and a season's press reaching one team alike. */
export const REGISTRIERUNGSLINK_TITEL: DispatchTitel = {
  gesendet: "Registrierungslink gesendet",
  fehlgeschlagen: "Registrierungslink nicht verschickt",
};

/**
 * An address change's toast: its link's, and with no link the request to the address on file, which is
 * then the change's one message.
 */
export function reportAddressChangeDispatch(link: boolean, description: string): void {
  appToast.success(link ? "Link gesendet" : "Anfrage gesendet", { description });
}

/** The toast of a write that landed and sent a link: a success only where the link went out. */
export function reportLinkDispatch(versand: LinkDispatch, titel: DispatchTitel, description: string): void {
  const raise = versand === "gesendet" ? appToast.success : appToast.warning;

  raise(titel[versand], { description });
}
