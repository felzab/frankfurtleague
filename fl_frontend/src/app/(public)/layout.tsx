import { ServerIsLive } from "@/features/system/components/ui/ServerIsLive";
import { PublicShell } from "@/shared/components/layout/shell/PublicShell";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <PublicShell serverStatusSlot={<ServerIsLive />}>{children}</PublicShell>;
}
