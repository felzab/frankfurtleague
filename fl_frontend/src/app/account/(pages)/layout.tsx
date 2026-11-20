import { ROUTES } from "@/core/routes";
import { RailColumn } from "@/kit/RailFrame";

import type { ReactNode } from "react";

/** Konto's three pages: on a phone the band leads back to the list of them, which leads back to the page Konto was opened from, else to the Übersicht. */
export default function AccountPagesLayout({ children }: { children: ReactNode }) {
  return <RailColumn back={ROUTES.account.path()}>{children}</RailColumn>;
}
