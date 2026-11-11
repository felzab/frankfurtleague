import { PersonFrame } from "../PersonFrame";

import type { ReactNode } from "react";

/**
 * A referee's frame, above the season of its pages' addresses. The phone's band and bar are the route groups'
 * (`RailColumn`): the match report lies in `(editor)`, the Übersicht in `(liste)`.
 */
export default function SchiedsrichterLayout({ children }: { children: ReactNode }) {
  return <PersonFrame place="schiedsrichter">{children}</PersonFrame>;
}
