import { runAdminRead } from "@/shared/utils/adminRead";

import { postAdresswechselVerwaltungAnsicht } from "./mutations";
import { mapVerwaltungAnsichtRefusal } from "./refusals";

import type { FLAddressChangeAdminViewResponse } from "@/core/generated/client/types";

/** What the address tool shows of one change or address: the read's answer, or the sentence of its own refusal. */
export type VerwaltungAnsichtGelesen = { status: "read"; view: FLAddressChangeAdminViewResponse } | { status: "refused"; reason: string };

/** The change a link from an editor, a reveal or the account page names, read as the tool opens on it. */
export async function getAdresswechselVerwaltungAnsicht(adresswechselId: string): Promise<VerwaltungAnsichtGelesen> {
  return runAdminRead(() => postAdresswechselVerwaltungAnsicht({ address_change_id: adresswechselId })).then(
    (view): VerwaltungAnsichtGelesen => ({ status: "read", view: view }),
    (error: unknown): VerwaltungAnsichtGelesen => {
      // An ended or unknown change is the panel's sentence; every other failure is the page's boundary.
      const reason = mapVerwaltungAnsichtRefusal(error);
      if (reason !== null) return { status: "refused", reason: reason };
      throw error;
    },
  );
}
