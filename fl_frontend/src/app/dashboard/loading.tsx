import { ContentLoader } from "@/shared/components/ui/ContentLoader";

// ContentLoader, not PageLoader: on a segment navigation here the shell (sidemenu, topbar) is
// already painted -- only the content region is loading, and the two loaders are deliberately
// distinct shapes so the situation is readable at a glance.
export default function Loading() {
  return <ContentLoader />;
}
