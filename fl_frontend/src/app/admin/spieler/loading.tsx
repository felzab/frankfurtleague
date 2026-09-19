import { SPIELER_CRUD_COPY } from "@/features/spieler/constants";
import { AdminCrudLoading } from "@/shared/components/ui/AdminCrudLoading";

export default function Loading() {
  return <AdminCrudLoading createLabel={SPIELER_CRUD_COPY.createLabel} />;
}
