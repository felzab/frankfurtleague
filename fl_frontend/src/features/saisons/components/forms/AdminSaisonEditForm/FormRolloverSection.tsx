"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ArrowRightArrowLeft } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { activateSaisonAction } from "@/features/saisons/actions";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { Callout } from "@/shared/components/ui/Callout";
import { DisabledHint } from "@/shared/components/ui/DisabledHint";
import { formButton } from "@/shared/components/ui/formButtons";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";
import { PANEL_REVEAL } from "@/shared/components/ui/motion";
import { appToast } from "@/shared/utils/appToast";
import { formatSpielDatum } from "@/shared/utils/format";

import { rolloverBlockedReason } from "./blockedReasons";

import type { FLSaisonStatus } from "@/features/saisons/schemas";
import type { SaisonRolloverContext } from "@/features/saisons/types";
import type { SaisonBanner } from "./banners";

/** How many unfinished fixtures the panel names before it stops listing and starts counting. */
const LISTED_OFFENE_SPIELE = 8;

/**
 * The rollover, on `POST /saisons/{saison_id}/activate`. **A confirmation step rather than an undo**,
 * unlike every other write here: it changes what every public page shows for both seasons at once, so
 * there is no window in which that is invisible.
 */
export function FormRolloverSection({
  saisonId,
  saisonStatus,
  rollover,
  hasDrawnSpiele,
  onBeforeActivate,
  banners,
}: {
  saisonId: string;
  saisonStatus: FLSaisonStatus;
  rollover: SaisonRolloverContext;
  /** `REQ-ACTIVATE-003`: whether THIS season holds fixtures, which is what it would go live with. */
  hasDrawnSpiele: boolean;
  /** Runs before the write; `false` cancels. The editor refuses while a draft is unsaved. */
  onBeforeActivate: () => boolean;
  banners: readonly SaisonBanner[];
}) {
  const router = useRouter();
  // The tone grades the act on offer, and only a `future` season has one: the running season has
  // nothing to switch to, and a `past` one is refused by `REQ-ACTIVATE-002`.
  const panel = formPanel({ tone: saisonStatus === "future" ? "danger" : "neutral" });
  const [isActivating, startActivating] = useTransition();
  const [isConfirming, setIsConfirming] = useState(false);

  const isAlreadyActive = saisonStatus === "active";
  const isFinishedSaison = saisonStatus === "past";
  const offene = rollover.offeneSpiele;
  const outgoing = rollover.outgoingSaisonId;

  const blockedReason = rolloverBlockedReason({ hasDrawnSpiele, outgoingSaisonId: outgoing, offeneSpieleCount: offene.length });

  const handleActivate = () => {
    // Checked on BOTH presses, as the draw's is: the fields stay live between arming and confirming,
    // and the refresh this ends with remounts the editor on the moved status, so a draft typed in
    // that window would go without a word.
    if (!onBeforeActivate()) {
      setIsConfirming(false);
      return;
    }

    if (!isConfirming) {
      setIsConfirming(true);
      return;
    }

    startActivating(async () => {
      const res = await activateSaisonAction({ id: saisonId });
      setIsConfirming(false);

      if (!res.success) {
        appToast.danger("Umstellung fehlgeschlagen", { description: res.error ?? "Ein unerwarteter Fehler ist aufgetreten." });
        return;
      }

      appToast.success("Saison umgestellt", { description: res.message });
      // The action's invalidation reaches the caches; this re-renders the page the admin stands on.
      router.refresh();
    });
  };

  return (
    <section className={panel.root()}>
      <div className={`${panel.header()} relative`}>
        <span className="absolute top-1/2 right-4 -translate-y-1/2 sm:right-5">
          {isAlreadyActive ? (
            <span className={`${LABEL_BADGE} bg-success/15 text-success-strong`}>Laufend</span>
          ) : saisonStatus === "future" ? (
            <span className={`${LABEL_BADGE} bg-info/15 text-info-strong`}>Geplant</span>
          ) : (
            <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Abgeschlossen</span>
          )}
        </span>
        <h2 className={panel.heading()}>
          Umstellung
          <InfoHint label="Hinweis zur Umstellung">
            <p>Die Umstellung macht diese Saison zur laufenden Saison.</p>
            <ul>
              <li>
                Die bisher laufende Saison wird im <strong>gleichen Schritt</strong> abgeschlossen.
              </li>
              <li>
                Wer keine Saison auswählt, sieht danach <strong>diese</strong>.
              </li>
              <li>Offene Spiele der alten Saison bleiben offen und bleiben bearbeitbar.</li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={panel.body()}>
        {isFinishedSaison ? (
          // Closed rather than disabled with a hint: `REQ-ACTIVATE-002` has no remedy, and a hint
          // saying what would unblock it would name a route the system does not have.
          <Callout
            severity="info"
            title="Diese Saison ist abgeschlossen">
            Eine abgeschlossene Saison wird nicht wieder zur laufenden Saison. Ihre Punkte, ihre Gruppen und die Tabelle daraus halten fest, was
            gespielt wurde, und eine Umstellung würde alle drei wieder öffnen. Der Abschluss lässt sich in der Verwaltung nicht zurücknehmen.
          </Callout>
        ) : isAlreadyActive ? (
          // Panel-local and deliberately not a banner: it answers "why can I not act HERE", which is a
          // question only this control raises.
          <Callout
            severity="info"
            title="Hier ist nichts umzustellen">
            Diese Saison läuft schon; umgestellt wird auf der Seite der Saison, die als nächste laufen soll.
          </Callout>
        ) : (
          <>
            {/* The outgoing season, named rather than assumed: on a fresh database there is none, and a
                panel that spoke of "the previous season" regardless would be describing a document
                that does not exist. */}
            <p className="fluid-sm text-foreground font-medium">
              {outgoing === null ? (
                <>
                  Derzeit ist keine Saison aktiv. Die Umstellung macht <strong>{saisonId}</strong> zur laufenden Saison.
                </>
              ) : (
                <>
                  Die Umstellung schließt Saison <strong>{outgoing}</strong> ab und macht <strong>{saisonId}</strong> zur laufenden Saison.
                </>
              )}
            </p>

            <InlineBanners
              banners={banners}
              spot="umstellung"
            />

            {/* In the body as well as on the control, the treatment the open-fixture list gets: a
                hover hint is the only other place this is said, and the remedy is a whole panel
                away. */}
            {!hasDrawnSpiele && (
              <Callout
                severity="warning"
                title="Diese Saison hat noch keinen Spielplan">
                Eine Saison ohne Spiele wird nicht zur laufenden Saison: Sie stünde öffentlich als laufende Saison da, und zu spielen gäbe es
                nichts. Lege den Spielplan im Abschnitt <strong>Spielplan</strong> an, dann lässt sich umstellen.
              </Callout>
            )}

            {/* The list, not a number: a count tells the operator that something is open and
                nothing about whether it matters. A finale without a result is a different decision
                from four group games nobody waits on. */}
            {offene.length > 0 && (
              <ul className="border-border divide-border/50 flex w-full flex-col divide-y rounded-xl border">
                {offene.slice(0, LISTED_OFFENE_SPIELE).map((spiel) => (
                  <li
                    key={spiel.id}
                    className="flex w-full flex-row items-center gap-x-3 px-3 py-2">
                    <span className="bg-muted text-foreground-muted fluid-xxs flex h-6 min-w-8 shrink-0 items-center justify-center rounded-md font-extrabold">
                      {spiel.spielNr}
                    </span>
                    <span className="fluid-xs text-foreground min-w-0 flex-1 truncate font-semibold">{spiel.paarung}</span>
                    <span className="fluid-xxs text-foreground-muted shrink-0">
                      {spiel.datum === null ? "Ohne Datum" : formatSpielDatum(spiel.datum)}
                    </span>
                    <Link
                      href={`/admin/spiele/${spiel.id}`}
                      className="text-brand hover:text-brand-solid fluid-xxs shrink-0 font-bold transition-colors">
                      Öffnen
                    </Link>
                  </li>
                ))}
                {/* Singular and plural spelled out: a remainder of one makes "1 weitere" out of a fixed plural. */}
                {offene.length > LISTED_OFFENE_SPIELE && (
                  <li className="fluid-xxs text-foreground-muted px-3 py-2 font-medium">
                    {offene.length - LISTED_OFFENE_SPIELE === 1
                      ? "und ein weiteres."
                      : `und ${String(offene.length - LISTED_OFFENE_SPIELE)} weitere.`}{" "}
                    Die vollständige Liste steht unter Handlungsbedarf.
                  </li>
                )}
              </ul>
            )}

            {/* Escalated in place, the two-step delete's shape: without `role="alert"` the only signal
                is the button label quietly changing. */}
            {isConfirming && (
              <div
                role="alert"
                className={`${PANEL_REVEAL} bg-danger/5 border-danger/20 flex flex-col gap-2 rounded-xl border p-4 shadow-sm`}>
                <strong className="fluid-xs text-danger-strong">Bist Du Dir sicher?</strong>
                <p className="fluid-xxs text-foreground leading-normal font-medium">
                  {outgoing === null
                    ? `Saison ${saisonId} wird sofort öffentlich als laufende Saison angezeigt.`
                    : `Saison ${outgoing} wird abgeschlossen und ${saisonId} sofort öffentlich als laufende Saison angezeigt.`}{" "}
                  Rückgängig geht das nur, indem Du die andere Saison wieder umstellst.
                </p>
              </div>
            )}

            {/* Disabled rather than left live to fail. The endpoint refuses both of these and
                stays the authority; this only stops the page offering an act it knows the answer
                to, and the body above says which one in a form the admin can act on. */}
            <div className="flex w-full flex-row flex-wrap items-center gap-3">
              {/* The body sits a screen away from the button, so the refusal is said again on the
                  control itself. `isActivating` is left out: it ends by itself. */}
              <DisabledHint reason={isActivating ? null : blockedReason}>
                <Button
                  type="button"
                  variant="primary"
                  isDisabled={isActivating || blockedReason !== null}
                  onPress={handleActivate}
                  className={`${formButton({ intent: isConfirming ? "destructive" : "submit" })} flex items-center gap-x-2`}>
                  {!isConfirming && (
                    <ArrowRightArrowLeft
                      aria-hidden="true"
                      width={18}
                      height={18}
                    />
                  )}
                  {isActivating ? "Stellt um..." : isConfirming ? `Ja, auf ${saisonId} umstellen` : `Saison ${saisonId} aktivieren`}
                </Button>
              </DisabledHint>
              {isConfirming && (
                <Button
                  type="button"
                  variant="secondary"
                  isDisabled={isActivating}
                  onPress={() => setIsConfirming(false)}
                  className={formButton({ intent: "cancel" })}>
                  Abbrechen
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
