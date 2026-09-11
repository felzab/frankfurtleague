"use client";

import { SCHIEDSRICHTER_ANONYM_LABEL } from "@/features/schiedsrichter/constants";
import { BackButton } from "@/shared/components/ui/BackButton";
import { ConfirmReadoutRow } from "@/shared/components/ui/ConfirmReadoutRow";
import { formPanel } from "@/shared/components/ui/formPanel";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { RetiredBadge } from "@/shared/components/ui/RetiredBadge";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";
import { formatEuro, formatSpielDatum } from "@/shared/utils/format";

// The write path refuses every save reaching an erased row (`REQ-ANONYMISE-002`), so an editor here
// would offer an empty name box that invites exactly the re-entry the refusal exists to stop.
/** The referee page once the erasure has run. **Read-only, and that is the point.** */
export function AdminSchiedsrichterGeloeschtView({
  anonymisiertAm,
  inactiveSince,
  defaultPayment,
}: {
  /** Non-null, the stamp being what routes a row here: a nameless row without one takes the editor. */
  anonymisiertAm: string;
  /** It may PREDATE the erasure: a referee retired last season keeps the day they retired. */
  inactiveSince: string | null;
  defaultPayment: number;
}) {
  const saisonHref = useSaisonHref();

  const panel = formPanel();

  return (
    // The frame `fl_frontend/src/features/bewerbungen/components/views/AdminBewerbungView.tsx` carries, never
    // `fl_frontend/src/shared/components/ui/EditFormLayout.tsx`'s: that renders an editor header whose exit is a
    // form's discard guard and whose hint promises a save this page refuses.
    <div className={`${PAGE_RISE} w-full p-6 sm:p-8`}>
      <div className="max-w-page mx-auto flex w-full flex-col">
        <BackButton fallbackHref={saisonHref("/admin/schiedsrichter")} />

        <header className="mb-6 flex w-full flex-col gap-y-2">
          {/* `h2`, never `h1` — the shell page owns that one. Italic, so the word reads as the state it
              is rather than as somebody's name. */}
          <div className="flex w-full flex-row items-center gap-x-3">
            <h2 className="fluid-2xl text-foreground-muted min-w-0 truncate font-extrabold tracking-tight italic">
              {SCHIEDSRICHTER_ANONYM_LABEL}
            </h2>
            {inactiveSince !== null && (
              <div className="flex shrink-0 items-center">
                <RetiredBadge since={inactiveSince} />
              </div>
            )}
          </div>
          <p className="muted-hint">An dieser Person lässt sich nichts mehr ändern.</p>
        </header>

        <section className={panel.root()}>
          <div className={panel.header()}>
            <PanelHeading
              className={panel.heading()}
              title="Daten gelöscht"
            />
          </div>

          <div className={panel.body()}>
            <p className="muted-hint">
              Name, Schule, E-Mail und Telefonnummer wurden auf Wunsch dieser Person gelöscht, in der Verwaltung und auf jedem Spiel. Der
              Eintrag ist stillgelegt und wird für neue Spiele nicht mehr angeboten. Die Spiele selbst bleiben erhalten, mit dem damals
              vereinbarten Honorar. Zurückholen lässt sich das nicht.
            </p>

            <dl className="flex w-full flex-col gap-y-1">
              <ConfirmReadoutRow
                label="Gelöscht am"
                value={formatSpielDatum(anonymisiertAm)}
              />
              {/* The one figure the erasure never reached, and it is this referee's own fee rather than
                  a league-wide rate, so a page that dropped it would hide a figure nobody can now read. */}
              <ConfirmReadoutRow
                label="Standard-Honorar"
                value={formatEuro(defaultPayment)}
              />
            </dl>
          </div>
        </section>
      </div>
    </div>
  );
}
