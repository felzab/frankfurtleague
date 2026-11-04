import { RailColumn } from "@/kit/RailFrame";

import { ROUTES } from "@/core/routes";

import type { ReactNode } from "react";

/** Konto's four pages: on a phone the band leads back to the list of them, which leads on to the Übersicht. */
export default function KontoPagesLayout({ children }: { children: ReactNode }) {
  return <RailColumn back={ROUTES.account.path()}>{children}</RailColumn>;
}
