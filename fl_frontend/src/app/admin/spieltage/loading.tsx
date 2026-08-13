import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";

// The route's own placeholder is the list's placeholder, so a navigation paints the shape the rows
// will fill rather than a second, unrelated loader first. Without it this segment shows the admin
// `ContentLoader`, and a reader crosses two different placeholders to reach one table.
export default function Loading() {
  return <AdminCrudFallback shape="sections" />;
}
