import { PersonFrame } from "../PersonFrame";

import type { ReactNode } from "react";

/** A pupil's frame, above the season of its page's address. */
export default function SpielerLayout({ children }: { children: ReactNode }) {
  return <PersonFrame place="spieler">{children}</PersonFrame>;
}
