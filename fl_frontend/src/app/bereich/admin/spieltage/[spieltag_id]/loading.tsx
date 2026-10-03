import { ContentLoader } from "@/shared/components/ui/ContentLoader";

/** The list segment above wraps this one too, and its skeleton draws a table where an editor is loading. */
export default function Loading() {
  return <ContentLoader />;
}
