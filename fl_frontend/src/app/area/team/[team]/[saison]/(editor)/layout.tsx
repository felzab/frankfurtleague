import { RailColumn } from "@/kit/RailFrame";

import type { ReactNode } from "react";

/**
 * A team's editors, the line-up: the band with „‹ Zurück“ to the list the rail marks for it, and no bottom bar, the
 * editor's own bar standing in its place. An editor's route lies here, so the server draws its band and bar right.
 */
export default function EditorLayout({ children }: { children: ReactNode }) {
  return <RailColumn editor>{children}</RailColumn>;
}
