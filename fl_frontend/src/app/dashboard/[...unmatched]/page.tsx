import { notFound } from "next/navigation";

// Reached only where every other dashboard route has already refused the address, so a mistyped one
// answers under the dashboard shell rather than under the visitor's (`docs/frontend/spec.md :: I232`).
export default function DashboardUnmatchedRoute() {
  notFound();
}
