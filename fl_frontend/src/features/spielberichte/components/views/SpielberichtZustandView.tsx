import { EmptyState } from "@/shared/components/ui/EmptyState";

/** The referee's panel, which lists every fixture a report is due for. */
export const SCHIEDSRICHTER_HREF = "/bereich/schiedsrichter";

/** A report page that offers no form: the switch is off, or the fixture admits no report from this reader now. */
export function SpielberichtZustandView({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="w-full p-6 sm:p-8">
      <div className="mx-auto flex w-full max-w-page flex-col gap-6">
        <EmptyState
          title={title}
          hint={hint}
          aktion={{ href: SCHIEDSRICHTER_HREF, label: "Zu Deinen Spielen" }}
        />
      </div>
    </div>
  );
}
