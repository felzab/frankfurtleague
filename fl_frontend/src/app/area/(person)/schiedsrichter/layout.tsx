import { PersonFrame } from "../PersonFrame";

import type { ReactNode } from "react";

/** A referee's frame, above the season of its pages' addresses. */
export default function SchiedsrichterLayout({ children }: { children: ReactNode }) {
  return <PersonFrame place="schiedsrichter">{children}</PersonFrame>;
}
