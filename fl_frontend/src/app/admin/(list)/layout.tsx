import { RailColumn } from "@/kit/RailFrame";

import type { ReactNode } from "react";

/** Every administration page that is no editor: the band with the logo, and the bottom bar under the page. */
export default function ListLayout({ children }: { children: ReactNode }) {
  return <RailColumn>{children}</RailColumn>;
}
