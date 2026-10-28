import { VerwaltungFrame } from "../VerwaltungFrame";

import type { ReactNode } from "react";

/** The frame of the administration's league-wide pages, whose address names no season. */
export default function VerwaltungLigaLayout({ children }: { children: ReactNode }) {
  return <VerwaltungFrame>{children}</VerwaltungFrame>;
}
