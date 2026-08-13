import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";

// The route's own placeholder is the list's, so a navigation paints the shape the rows will fill
// rather than the segment's `ContentLoader` first and this second.
export default function Loading() {
  return <AdminCrudFallback />;
}
