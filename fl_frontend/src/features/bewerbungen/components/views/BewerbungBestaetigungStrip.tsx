"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { CircleCheck, CircleXmark, Clock, PaperPlane } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { einwilligungErneutSendenAction } from "@/features/bewerbungen/actions";
import { KONTAKT_ROLLEN } from "@/features/teams/constants";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { formButton } from "@/shared/components/ui/formButtons";
import { formPanel } from "@/shared/components/ui/formPanel";
import { appToast } from "@/shared/utils/appToast";
import { formatSpielDatum } from "@/shared/utils/format";
import { UNKNOWN_REFUSAL } from "@/shared/utils/refusal";

import type { FLBewerbung } from "@/features/bewerbungen/schemas";
import type { KontaktRolle } from "@/features/teams/constants";

/** What one seat's confirmation has reached. A seat that has answered carries the day it answered on. */
type Stand =
  | { art: "bestaetigt"; am: string }
  | { art: "abgelehnt"; am: string }
  // `verschicktAm` is null where an erasure took the seat's block with the person it belonged to, so
  // the row has a state to show and no day to show it on.
  | { art: "ausstehend"; verschicktAm: string | null; erinnertAm: string | null };

export type SitzBestaetigung = {
  rolle: KontaktRolle;
  label: string;
  /** Null where a decline or an erasure emptied the slot; an erasure clears the seat's block beside it. */
  name: string | null;
  zugleichTrainer: boolean;
  stand: Stand;
  /** Rendered here rather than by each surface: the strip and the fact panel say one thing about one seat. */
  satz: string;
};

/**
 * `null` where the application predates the workflow. An absent block is what keeps such an
 * application acceptable, so it answers "no such state" rather than three outstanding seats, which
 * would close the Zusage on every queued application.
 */
export function bestaetigungsStand(bewerbung: Pick<FLBewerbung, "bestaetigungen" | "kontakte">): SitzBestaetigung[] | null {
  const { bestaetigungen, kontakte } = bewerbung;

  if (bestaetigungen === null) return null;

  // `KONTAKT_ROLLEN` and never a list of this file's own: the seat order is the label table's
  // (`.claude/rules/frontend.md` **admin**).
  return KONTAKT_ROLLEN.map(({ value, label }) => {
    const person = kontakte[value];
    const verlauf = bestaetigungen[value];
    const bestaetigtAm = person?.einwilligung.bestaetigt_am ?? null;
    const abgelehntAm = verlauf?.abgelehnt_am ?? null;

    // The stamp on the record wins over the block: a seat confirms once, and the block goes on
    // carrying the day its link went out.
    const stand: Stand =
      bestaetigtAm !== null
        ? { art: "bestaetigt", am: bestaetigtAm }
        : abgelehntAm !== null
          ? { art: "abgelehnt", am: abgelehntAm }
          : { art: "ausstehend", verschicktAm: verlauf?.verschickt_am ?? null, erinnertAm: verlauf?.erinnert_am ?? null };

    return {
      rolle: value,
      label: label,
      name: person === null ? null : `${person.vorname} ${person.nachname}`,
      zugleichTrainer: kontakte.trainer_ist_zugleich === value,
      stand: stand,
      satz: standSatz(stand),
    };
  });
}

/** A seat the acceptance is still waiting on. A decline blocks it too: the emptied slot carries no confirmation. */
export function istOffen({ stand }: SitzBestaetigung): boolean {
  return stand.art !== "bestaetigt";
}

/**
 * German lists nothing with a comma before its last item. Spelled here rather than imported from
 * `fl_frontend/src/core/bewerbungEmail.ts :: joinUnd`, which is `server-only` and so out of reach of
 * a component the browser runs.
 */
export function nenneUnd(teile: readonly string[]): string {
  if (teile.length < 2) return teile[0] ?? "";

  return `${teile.slice(0, -1).join(", ")} und ${teile[teile.length - 1]!}`;
}

/** One seat's state as a sentence. A reminded seat names the reminder: that is the day the person last heard from the league. */
function standSatz(stand: Stand): string {
  if (stand.art === "bestaetigt") return `Bestätigt am ${formatSpielDatum(stand.am)}`;
  if (stand.art === "abgelehnt") return `Abgelehnt am ${formatSpielDatum(stand.am)}`;

  if (stand.erinnertAm !== null) return `Ausstehend, erinnert am ${formatSpielDatum(stand.erinnertAm)}`;

  return stand.verschicktAm === null
    ? "Ausstehend, kein Link unterwegs"
    : `Ausstehend, Link gesendet am ${formatSpielDatum(stand.verschicktAm)}`;
}

const STAND_TINT: Record<Stand["art"], string> = {
  bestaetigt: "bg-success/15 text-success-strong",
  ausstehend: "bg-warning/15 text-warning-strong",
  abgelehnt: "bg-danger/15 text-danger-strong",
};

const STAND_ICON = {
  bestaetigt: CircleCheck,
  ausstehend: Clock,
  abgelehnt: CircleXmark,
} as const;

/**
 * A readout above the fact panels rather than a section inside them, so the question deciding
 * whether the Zusage is possible at all is answered before the panels it governs.
 */
export function BewerbungBestaetigungStrip({
  bewerbungId,
  staende,
  frist,
  isOpen,
}: {
  bewerbungId: string;
  staende: readonly SitzBestaetigung[];
  /** The day an incomplete application is deleted on, or `null` where none is recorded. */
  frist: string | null;
  /** Whether the application is still `eingereicht` — the one state a re-sent link can be answered in. */
  isOpen: boolean;
}) {
  const router = useRouter();
  // Per seat rather than one flag: three buttons stand here, and one press must not disable the others.
  const [sendendeRolle, setSendendeRolle] = useState<KontaktRolle | null>(null);

  const panel = formPanel();
  const bestaetigt = staende.filter((sitz) => !istOffen(sitz)).length;
  const offen = staende.filter(istOffen);

  const sendeErneut = async (sitz: SitzBestaetigung) => {
    setSendendeRolle(sitz.rolle);

    const res = await einwilligungErneutSendenAction({ id: bewerbungId, rolle: sitz.rolle });

    setSendendeRolle(null);

    if (!res.success) {
      appToast.danger("Link nicht erneut gesendet", { description: res.error ?? UNKNOWN_REFUSAL });
      return;
    }

    appToast.success("Link erneut gesendet", { description: res.message });
    // The deadline and the seat's own stamp both moved, and this readout renders them.
    router.refresh();
  };

  return (
    <section className={panel.root()}>
      <div className={panel.body()}>
        <div className="flex w-full flex-row flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="fluid-xxs text-foreground-muted font-bold tracking-wider uppercase">Einwilligungen</span>
          <span className="fluid-sm text-foreground font-semibold">
            {String(bestaetigt)} von {String(staende.length)} bestätigt
          </span>
        </div>

        <div className="flex w-full flex-col gap-y-3">
          {staende.map((sitz) => {
            const Glyph = STAND_ICON[sitz.stand.art];
            const sendet = sendendeRolle === sitz.rolle;

            return (
              <div
                key={sitz.rolle}
                className="flex w-full flex-row flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>{sitz.label}</span>
                {sitz.zugleichTrainer && <span className={`${LABEL_BADGE} bg-brand/10 text-brand-solid`}>Zugleich Trainer</span>}

                <span className="fluid-sm text-foreground min-w-0 font-medium">
                  {sitz.name ?? <span className="text-foreground-muted/50 italic">Niemand mehr in der Bewerbung</span>}
                </span>

                <span className={`${LABEL_BADGE} ${STAND_TINT[sitz.stand.art]} ml-auto gap-x-1`}>
                  <Glyph
                    aria-hidden="true"
                    width={14}
                    height={14}
                  />
                  {sitz.satz}
                </span>

                {isOpen && sitz.stand.art === "ausstehend" && (
                  <Button
                    type="button"
                    isDisabled={sendet}
                    aria-label={`Link erneut senden an ${sitz.label}`}
                    onPress={() => {
                      void sendeErneut(sitz);
                    }}
                    className={`${formButton({ intent: "nav", size: "sm" })} gap-x-2`}>
                    <PaperPlane
                      aria-hidden="true"
                      width={16}
                      height={16}
                    />
                    <span>{sendet ? "Sendet..." : "Link erneut senden"}</span>
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {/* The deletion date stands here and nowhere else on the page: the acceptance's own closure
            says what is missing, and this says what happens if it stays missing. */}
        {offen.length > 0 && frist !== null && (
          <p className="muted-hint">Bleibt eine Bestätigung bis zum {formatSpielDatum(frist)} aus, wird die Bewerbung gelöscht.</p>
        )}
      </div>
    </section>
  );
}
