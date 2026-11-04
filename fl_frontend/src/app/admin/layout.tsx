import { VerwaltungFrame } from "./VerwaltungFrame";

import type { ReactNode } from "react";

/** The administration's one frame, around its league-wide pages and its season pages alike. */
export default function VerwaltungLayout({ children }: { children: ReactNode }) {
  return <VerwaltungFrame>{children}</VerwaltungFrame>;
}
