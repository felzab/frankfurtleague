import "client-only";

import { appToast } from "./appToast";

/** How one link mail ended for the press that sent it: handed on to be mailed, or not. */
type LinkDispatch = "sent" | "failed";

/**
 * A press's title for each way its link ended. **No title here is a press's failure title**, which
 * `appToast.failure` raises at another variant.
 */
export type DispatchTitle = Readonly<Record<LinkDispatch, string>>;

/** A team's registration link, its own press and a season's press reaching one team alike. */
export const REGISTRIERUNGSLINK_TITLE: DispatchTitle = {
  sent: "Registrierungslink gesendet",
  failed: "Registrierungslink nicht verschickt",
};

/**
 * An address change's toast: its link's, and with no link the request to the address on file, which is
 * then the change's one message.
 */
export function reportAddressChangeDispatch(link: boolean, description: string): void {
  appToast.success(link ? "Link gesendet" : "Anfrage gesendet", { description });
}

/** The toast of a write that landed and sent a link: a success only where the link went out. */
export function reportLinkDispatch(dispatch: LinkDispatch, title: DispatchTitle, description: string): void {
  const raise = dispatch === "sent" ? appToast.success : appToast.warning;

  raise(title[dispatch], { description });
}
