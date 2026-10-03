import { SAISONS_CRUD_COPY } from "@/features/saisons/constants";
import { AdminCrudLoading } from "@/shared/components/ui/AdminCrudLoading";

export default function Loading() {
  return (
    <AdminCrudLoading
      hasFacets={false}
      createLabel={SAISONS_CRUD_COPY.createLabel}
    />
  );
}
