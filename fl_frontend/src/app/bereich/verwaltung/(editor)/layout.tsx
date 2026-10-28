import { VerwaltungColumn } from "../VerwaltungFrame";

import type { ReactNode } from "react";

/**
 * The administration's editors: the band with „‹ Zurück“ to the record's list, and no bottom bar, the editor's
 * own bar standing in its place. An editor's route lies here, so the server draws its band and bar right.
 */
export default function EditorLayout({ children }: { children: ReactNode }) {
  return <VerwaltungColumn editor>{children}</VerwaltungColumn>;
}
