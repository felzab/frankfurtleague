import { RailColumn } from "@/kit/RailFrame";

import { ROUTES } from "@/core/routes";

import type { ReactNode } from "react";

/** The list of Konto's pages: the phone's band leads back to the Übersicht, as the rail's head does. */
export default function KontoListLayout({ children }: { children: ReactNode }) {
  return <RailColumn back={ROUTES.area.path()}>{children}</RailColumn>;
}
