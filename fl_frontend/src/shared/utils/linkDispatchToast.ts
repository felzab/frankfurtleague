import "client-only";

import { appToast } from "./appToast";

/**
 * An address change's toast: its link's, and with no link the request to the address on file, which is
 * then the change's one message.
 */
export function reportAddressChangeDispatch(link: boolean, description: string): void {
  appToast.success(link ? "Link gesendet" : "Anfrage gesendet", { description });
}
