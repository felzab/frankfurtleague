import { RailFrame } from "@/kit/RailFrame";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { readAccount } from "@/features/konto/account";

import { KONTO_ENTRIES } from "./entries";

import type { ReactNode } from "react";

/**
 * Konto's frame, in place of the area's: its own rail of its four pages, „‹ Zurück“ in the logo's place leading to
 * the Übersicht, and no bottom bar, the phone opening on the list of the four instead. The frame is drawn without
 * waiting for the session, the account row streaming in; each page's own read sends a session turned away to sign in.
 * The phone's band is the route groups' (`(list)`, `(pages)`), since its way back differs: the list's to the
 * Übersicht, a page's to the list.
 */
export default function KontoLayout({ children }: { children: ReactNode }) {
  return (
    <RailFrame
      groups={[{ entries: KONTO_ENTRIES }]}
      bar={["signin"]}
      foot={{ kind: "account", account: readAccount(COPY.template.account) }}
      // The landing sends a session on to the page its Funktionen open on, its Übersicht.
      back={ROUTES.signInLanding.path()}
      columnInLayouts>
      {children}
    </RailFrame>
  );
}
