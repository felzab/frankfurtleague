import { TEAMS_CRUD_COPY } from "@/features/teams/constants";
import { AdminCrudLoading } from "@/shared/components/ui/AdminCrudLoading";

export default function Loading() {
  return <AdminCrudLoading createLabel={TEAMS_CRUD_COPY.createLabel} />;
}
