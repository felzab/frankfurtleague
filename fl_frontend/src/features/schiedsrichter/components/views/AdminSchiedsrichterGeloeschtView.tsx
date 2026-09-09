"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { ArrowUturnCwLeft } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { SCHIEDSRICHTER_ANONYM_LABEL } from "@/features/schiedsrichter/constants";
import { ConfirmReadoutRow } from "@/shared/components/ui/ConfirmReadoutRow";
import { formButton } from "@/shared/components/ui/formButtons";
import { formPanel } from "@/shared/components/ui/formPanel";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { RetiredBadge } from "@/shared/components/ui/RetiredBadge";
import { formatEuro, formatSpielDatum } from "@/shared/utils/format";

// The write path refuses every save reaching an erased row (`REQ-ANONYMISE-002`), so an editor here
// would offer an empty name box that invites exactly the re-entry the refusal exists to stop.
/** The referee page once the erasure has run. **Read-only, and that is the point.** */
export function AdminSchiedsrichterGeloeschtView({
  anonymisiertAm,
  inactiveSince,
  defaultPayment,
}: {
  /** `null` only for a row a hand-write left nameless without stamping it: no date is invented for one. */
  anonymisiertAm: string | null;
  /** It may PREDATE the erasure: a referee retired last season keeps the day they retired. */
  inactiveSince: string | null;
  defaultPayment: number;
}) {
  const router = useRouter();
  const [isLeaving, startLeaving] = useTransition();

  const panel = formPanel();

  return (
    <div className={`${PAGE_RISE} flex w-full flex-col`}>
      <Button
        onPress={() => {
          // The pending flag is what ends react-aria's hover (`docs/frontend/spec.md :: I68`).
          startLeaving(() => {
            router.back();
          });
        }}
        isDisabled={isLeaving}
        className={`${formButton({ intent: "nav", size: "sm" })} mb-6 w-fit gap-x-2`}>
        <ArrowUturnCwLeft className="h-4 w-4 shrink-0" />
        <span>Zurück</span>
      </Button>

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
            Name, Schule, E-Mail und Telefonnummer wurden auf Wunsch dieser Person gelöscht, in der Verwaltung und auf jedem Spiel. Der Eintrag
            ist stillgelegt und wird für neue Spiele nicht mehr angeboten. Die Spiele selbst bleiben erhalten, mit dem damals vereinbarten
            Honorar. Zurückholen lässt sich das nicht.
          </p>

          <dl className="flex w-full flex-col gap-y-1">
            {anonymisiertAm !== null && (
              <ConfirmReadoutRow
                label="Gelöscht am"
                value={formatSpielDatum(anonymisiertAm)}
              />
            )}
            {/* The one figure the erasure never reached, so the page says plainly what still stands: it
                is the league's own rate rather than anything about this person. */}
            <ConfirmReadoutRow
              label="Standard-Honorar"
              value={formatEuro(defaultPayment)}
            />
          </dl>
        </div>
      </section>
    </div>
  );
}
