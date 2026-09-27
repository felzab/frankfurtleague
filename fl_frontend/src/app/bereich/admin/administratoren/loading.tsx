import { BERECHTIGUNGEN_CRUD_COPY } from "@/features/berechtigungen/constants";
import { AdminCrudLoading } from "@/shared/components/ui/AdminCrudLoading";

export default function Loading() {
  return (
    <AdminCrudLoading
      shape="cards"
      hasFacets={false}
      createLabel={BERECHTIGUNGEN_CRUD_COPY.createLabel}
    />
  );
}
