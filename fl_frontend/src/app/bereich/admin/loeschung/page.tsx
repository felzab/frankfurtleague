import { AdminLoeschungView } from "@/features/funktionen/components/views/AdminLoeschungView";
import { requireAdminRequest } from "@/shared/utils/adminRead";

export default async function AdminLoeschungPage() {
  // The builder stage has no reachable store, so a session read resolved at build time fails the image build.
  // It reads nothing, so it asks the check its first read would have asked.
  await requireAdminRequest();

  return <AdminLoeschungView />;
}
