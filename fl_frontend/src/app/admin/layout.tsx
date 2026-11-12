import { AdminFrame } from "./AdminFrame";

import type { ReactNode } from "react";

/** The administration's one frame, around its league-wide pages and its season pages alike. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminFrame>{children}</AdminFrame>;
}
