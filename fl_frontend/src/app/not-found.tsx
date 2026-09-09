import { ServerIsLive } from "@/features/system/components/ui/ServerIsLive";
import { PublicShell } from "@/shared/components/layout/shell/PublicShell";
import { NotFound } from "@/shared/components/ui/NotFound";

// The root file rather than one inside `(public)`: this is what answers an unmatched URL, and a file
// in that group answers only the paths the group already routes.
export default function NotfoundPage() {
  return (
    <PublicShell serverStatusSlot={<ServerIsLive />}>
      <NotFound />
    </PublicShell>
  );
}
