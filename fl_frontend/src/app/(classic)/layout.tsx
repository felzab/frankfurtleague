import { Classic } from "./frame";

import type { ReactNode } from "react";

/**
 * The classic public frame around the pages it holds. A match row on the landing opens its pop-up in the root layout's
 * slot, which serves every frame.
 */
export default function ClassicLayout({ children }: { children: ReactNode }) {
  return <Classic>{children}</Classic>;
}
