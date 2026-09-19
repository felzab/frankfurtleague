import { SCHIEDSRICHTER_CRUD_COPY } from "@/features/schiedsrichter/constants";
import { AdminCrudLoading } from "@/shared/components/ui/AdminCrudLoading";

export default function Loading() {
  return <AdminCrudLoading createLabel={SCHIEDSRICHTER_CRUD_COPY.createLabel} />;
}
