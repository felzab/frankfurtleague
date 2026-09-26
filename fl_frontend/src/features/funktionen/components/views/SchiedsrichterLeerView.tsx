import { EmptyState } from "@/shared/components/ui/EmptyState";

/** Every referee's page until an assignment read exists to fill it. */
export function SchiedsrichterLeerView() {
  return (
    <div className="w-full p-6 sm:p-8">
      <div className="mx-auto flex w-full max-w-page flex-col gap-6">
        <EmptyState title="Dir ist noch kein Spiel zugeteilt." />
      </div>
    </div>
  );
}
