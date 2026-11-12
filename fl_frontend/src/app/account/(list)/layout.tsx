import { RailColumn } from "@/kit/RailFrame";

import { readAreaBack } from "@/features/account/account";

import type { ReactNode } from "react";

/** The list of Konto's pages: the phone's band leads back to the Übersicht, or holds the logo, as the rail's head does. */
export default function AccountListLayout({ children }: { children: ReactNode }) {
  return <RailColumn back={readAreaBack()}>{children}</RailColumn>;
}
