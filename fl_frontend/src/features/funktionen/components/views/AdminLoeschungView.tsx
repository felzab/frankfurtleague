import { FormAbmeldenSection } from "@/features/funktionen/components/forms/AdminLoeschungForm/FormAbmeldenSection";
import { FormPersonLoeschenSection } from "@/features/funktionen/components/forms/AdminLoeschungForm/FormPersonLoeschenSection";
import { PAGE_RISE_CLASSES } from "@/shared/components/ui/motion";

/** A request by mail answered in place: two panels and no record, each panel reading only what its own press asks. */
export function AdminLoeschungView() {
  return (
    <div className={`${PAGE_RISE_CLASSES} w-full p-6 sm:p-8`}>
      <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6">
        <FormPersonLoeschenSection />
        <FormAbmeldenSection />
      </div>
    </div>
  );
}
