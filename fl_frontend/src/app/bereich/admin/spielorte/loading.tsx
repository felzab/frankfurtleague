import { SPIELORTE_CRUD_COPY } from "@/features/spielorte/constants";
import { AdminCrudLoading } from "@/shared/components/ui/AdminCrudLoading";

export default function Loading() {
  return <AdminCrudLoading createLabel={SPIELORTE_CRUD_COPY.createLabel} />;
}
