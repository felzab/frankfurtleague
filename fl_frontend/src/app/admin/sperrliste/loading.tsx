import { SPERRLISTE_CRUD_COPY } from "@/features/sperrliste/constants";
import { AdminCrudLoading } from "@/shared/components/ui/AdminCrudLoading";

export default function Loading() {
  return (
    <AdminCrudLoading
      shape="cards"
      hasFacets={false}
      createLabel={SPERRLISTE_CRUD_COPY.createLabel}
    />
  );
}
