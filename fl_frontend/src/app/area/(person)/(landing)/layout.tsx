import { PersonFrame } from "../PersonFrame";

import type { ReactNode } from "react";

/** The landing's frame, around the page that lists a person's places or sends a person holding one straight on. */
export default function LandingLayout({ children }: { children: ReactNode }) {
  return <PersonFrame place="landing">{children}</PersonFrame>;
}
