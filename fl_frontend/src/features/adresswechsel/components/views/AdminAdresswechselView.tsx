import { FormAdresswechselSection } from "@/features/adresswechsel/components/forms/AdminAdresswechselForm/FormAdresswechselSection";
import { PAGE_RISE_CLASSES } from "@/shared/components/ui/motion";

import type { VerwaltungAnsichtGelesen } from "@/features/adresswechsel/queries";

/** A request by mail answered in place, as the erasure's page answers one: one panel, reading only what its press asks. */
export function AdminAdresswechselView({ anfang }: { anfang: VerwaltungAnsichtGelesen | null }) {
  return (
    <div className={`${PAGE_RISE_CLASSES} w-full p-6 sm:p-8`}>
      <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6">
        <FormAdresswechselSection anfang={anfang} />
      </div>
    </div>
  );
}
