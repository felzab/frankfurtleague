"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { CircleCheck, CircleXmark, Clock, PaperPlane } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { einwilligungErneutSendenAction } from "@/features/bewerbungen/actions";
import { istOffen, linkAngebot } from "@/features/bewerbungen/bestaetigungStand";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { formButton } from "@/shared/components/ui/formButtons";
import { formPanel } from "@/shared/components/ui/formPanel";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { appToast } from "@/shared/utils/appToast";
import { formatSpielDatum } from "@/shared/utils/format";
import { UNKNOWN_REFUSAL } from "@/shared/utils/refusal";

import type { SitzBestaetigung } from "@/features/bewerbungen/bestaetigungStand";
import type { KontaktRolle } from "@/features/teams/constants";

/**
 * One height for every chip on this readout and for the control beside them, so a row carrying a
 * button does not stand taller than the rows that do not. `formButton`'s `xs` step is the other half.
 */
const STRIP_CHIP = `${LABEL_BADGE} h-7 shrink-0`;

/** Named rather than muted: a grey chip on a coloured row reads as disabled (my rule, 2026-09-04). */
const ROLLEN_TINT = "bg-info/15 text-info-strong";

/**
 * Never `warning`, which is what the rows beneath give an outstanding SEAT: one tone for the summary
 * and the thing it summarises reads as one state (my rule, 2026-09-04).
 */
const ZAEHLER_TINT = { offen: "bg-brand/10 text-brand-solid", vollstaendig: "bg-success/15 text-success-strong" };

const STAND_TINT: Record<SitzBestaetigung["stand"]["art"], string> = {
  bestaetigt: "bg-success/15 text-success-strong",
  ausstehend: "bg-warning/15 text-warning-strong",
  abgelehnt: "bg-danger/15 text-danger-strong",
  // A decline's grade for a seat that ends the same way: neither can be confirmed, and both leave
  // the Absage as the one decision the application still takes.
  geloescht: "bg-danger/15 text-danger-strong",
};

const STAND_ICON = {
  bestaetigt: CircleCheck,
  ausstehend: Clock,
  abgelehnt: CircleXmark,
  geloescht: CircleXmark,
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
  const angebot = linkAngebot(staende);

  const sendeErneut = async (sitz: SitzBestaetigung) => {
    setSendendeRolle(sitz.rolle);

    const res = await einwilligungErneutSendenAction({ id: bewerbungId, rolle: sitz.rolle });

    setSendendeRolle(null);

    // Before the toast either way: the failure arm reports a write that committed, so the readout
    // beneath it is stale on exactly the press that says so.
    router.refresh();

    if (!res.success) {
      appToast.danger("Link nicht erneut gesendet", { description: res.error ?? UNKNOWN_REFUSAL });
      return;
    }

    appToast.success("Link erneut gesendet", { description: res.message });
  };

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        {/* The count beside the heading, in the shape `AdminBewerbungView`'s own header gives a
            status chip: `PanelHeading` has one slot and it belongs to the hint glyph. */}
        <div className="flex w-full flex-row items-center gap-x-3">
          <PanelHeading
            className={panel.heading()}
            title="Einwilligungen"
          />
          <span className="shrink-0">
            <span className={`${STRIP_CHIP} ${bestaetigt === staende.length ? ZAEHLER_TINT.vollstaendig : ZAEHLER_TINT.offen}`}>
              {String(bestaetigt)} von {String(staende.length)} bestätigt
            </span>
          </span>
        </div>
      </div>

      <div className={panel.body()}>
        <div className="flex w-full flex-col gap-y-3">
          {staende.map((sitz) => {
            const Glyph = STAND_ICON[sitz.stand.art];
            const sendet = sendendeRolle === sitz.rolle;

            return (
              <div
                key={sitz.rolle}
                className="flex w-full flex-row flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className={`${STRIP_CHIP} ${ROLLEN_TINT}`}>{sitz.label}</span>
                {sitz.zugleichTrainer && <span className={`${STRIP_CHIP} bg-brand/10 text-brand-solid`}>Zugleich Trainer</span>}

                <span className="fluid-sm text-foreground min-w-0 font-medium">
                  {sitz.name === null ? <span className="text-foreground-muted italic">{sitz.nameSatz}</span> : sitz.nameSatz}
                </span>

                <span className={`${STRIP_CHIP} ${STAND_TINT[sitz.stand.art]} ml-auto gap-x-1`}>
                  <Glyph
                    aria-hidden="true"
                    width={14}
                    height={14}
                  />
                  {sitz.satz}
                </span>

                {isOpen && angebot.has(sitz.rolle) && (
                  <Button
                    type="button"
                    isDisabled={sendet}
                    aria-label={`Link erneut senden an ${sitz.label}`}
                    onPress={() => {
                      void sendeErneut(sitz);
                    }}
                    className={`${formButton({ intent: "nav", size: "xs" })} shrink-0 gap-x-2`}>
                    <PaperPlane
                      aria-hidden="true"
                      width={14}
                      height={14}
                    />
                    <span>{sendet ? "Wird gesendet..." : "Link erneut senden"}</span>
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {/* The deletion date stands here and nowhere else on the page: the reason under the closed
            Zusage says what is missing, and this says what happens if it stays missing. */}
        {offen.length > 0 && frist !== null && (
          <p className="muted-hint">Bleibt eine Bestätigung bis zum {formatSpielDatum(frist)} aus, wird die Bewerbung gelöscht.</p>
        )}
      </div>
    </section>
  );
}
