"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ArrowRightArrowLeft } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { activateSaisonAction } from "@/features/saisons/actions";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { Callout } from "@/shared/components/ui/Callout";
import { formButton } from "@/shared/components/ui/formButtons";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { appToast } from "@/shared/utils/appToast";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLSaisonStatus } from "@/features/saisons/schemas";
import type { SaisonRolloverContext } from "@/features/saisons/types";

/** How many unfinished fixtures the panel names before it stops listing and starts counting. */
const LISTED_OFFENE_SPIELE = 8;

/**
 * The rollover: one button on `POST /saisons/{saison_id}/activate`, which promotes this season and
 * demotes the incumbent in one transaction on the backend.
 *
 * **The endpoint refuses a rollover while the outgoing season has unplayed fixtures**
 * (`REQ-ACTIVATE-001`), and it is the authority. This panel names what is incomplete in the OUTGOING
 * season and disables the control, so the refusal is visible before the request rather than as a
 * 409 afterwards — see `fl_frontend/src/features/saisons/actions.ts :: activateSaisonAction` for
 * what happens when the picture changes under the page.
 *
 * **A control rather than a field.** It writes the moment it is pressed and never joins the save bar,
 * the same shape the retire and reactivate controls take on the club and player editors. `status` is on
 * no payload and cannot be drafted.
 *
 * **A confirmation step rather than an undo**, which is the opposite of every other write on this
 * surface, and the reason is what the write does: the rollover changes what every public page shows to
 * a visitor who named no season, and it does so for both seasons at once. There is no toast window in
 * which that is invisible, so the useful protection is before rather than after.
 */
export function FormRolloverSection({
  saisonId,
  saisonStatus,
  rollover,
  onBeforeActivate,
}: {
  saisonId: string;
  saisonStatus: FLSaisonStatus;
  rollover: SaisonRolloverContext;
  /**
   * Runs before the write. The editor uses it to refuse while a draft is unsaved: a rollover
   * revalidates the route, so an unsaved edit would be discarded by a control that says nothing about
   * editing. Returning `false` cancels.
   */
  onBeforeActivate: () => boolean;
}) {
  const router = useRouter();
  const panel = formPanel({ tone: saisonStatus === "active" ? "neutral" : "danger" });
  const [isActivating, startActivating] = useTransition();
  const [isConfirming, setIsConfirming] = useState(false);

  const isAlreadyActive = saisonStatus === "active";
  const offene = rollover.offeneSpiele;
  const outgoing = rollover.outgoingSaisonId;

  // An outgoing season with unplayed fixtures is what the endpoint refuses, so the control does not offer
  // it. There is no such season to be unfinished when nothing holds `active`, which is the first rollover
  // of a fresh database — that case stays live.
  const isBlocked = outgoing !== null && offene.length > 0;

  const handleActivate = () => {
    if (!isConfirming) {
      if (!onBeforeActivate()) return;
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
      // The action's own invalidation reaches the caches; this is what re-renders the page the admin is
      // still standing on, whose status badge and panel tone both just changed.
      router.refresh();
    });
  };

  return (
    <section className={panel.root()}>
      <div className={`${panel.header()} relative`}>
        <span className="absolute top-1/2 right-4 -translate-y-1/2 sm:right-5">
          {isAlreadyActive ? (
            <span className={`${LABEL_BADGE} bg-success/15 text-success-strong`}>Aktiv</span>
          ) : saisonStatus === "future" ? (
            <span className={`${LABEL_BADGE} bg-info/15 text-info-strong`}>Geplant</span>
          ) : (
            <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Abgeschlossen</span>
          )}
        </span>
        <h2 className={panel.heading()}>
          Umstellung
          <InfoHint label="Hinweis zur Umstellung">
            <p>Die Umstellung macht diese Saison zur laufenden.</p>
            <ul>
              <li>
                Die bisher laufende Saison wird im <strong>gleichen Schritt</strong> abgeschlossen.
              </li>
              <li>
                Jede Seite ohne ausgewählte Saison zeigt danach <strong>diese</strong> Saison.
              </li>
              <li>Offene Spiele der alten Saison bleiben offen und bleiben bearbeitbar.</li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={panel.body()}>
        {isAlreadyActive ? (
          <Callout
            severity="info"
            title="Diese Saison ist die laufende">
            Jede Seite ohne ausgewählte Saison zeigt sie. Umgestellt wird auf der Seite der Saison, die als nächste laufen soll.
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

            {outgoing !== null && offene.length > 0 && (
              <Callout
                severity="danger"
                title={
                  offene.length === 1
                    ? `1 Spiel der Saison ${outgoing} hat noch kein Ergebnis`
                    : `${String(offene.length)} Spiele der Saison ${outgoing} haben noch kein Ergebnis`
                }>
                Solange das so ist, lässt sich Saison {outgoing} nicht abschließen. Trage die fehlenden Ergebnisse ein oder sage die Spiele ab —
                ein abgesagtes Spiel gilt als erledigt.
              </Callout>
            )}

            {/* The list, not a number: the count alone tells the operator that something is open and
                nothing about whether it matters. A finale without a result is a different decision from
                four group games nobody is waiting on, and each row links straight to the fixture. */}
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
                {offene.length > LISTED_OFFENE_SPIELE && (
                  <li className="fluid-xxs text-foreground-muted px-3 py-2 font-medium">
                    und {String(offene.length - LISTED_OFFENE_SPIELE)} weitere. Die vollständige Liste steht unter Handlungsbedarf.
                  </li>
                )}
              </ul>
            )}

            {/* Escalated in place, the two-step delete's shape: without `role="alert"` the only signal
                is the button label quietly changing. */}
            {isConfirming && (
              <div
                role="alert"
                className="animate-in fade-in slide-in-from-bottom-4 bg-danger/5 border-danger/20 flex flex-col gap-2 rounded-xl border p-4 shadow-sm duration-400">
                <strong className="fluid-xs text-danger-strong">Bist Du Dir sicher?</strong>
                <p className="fluid-xxs text-foreground leading-normal font-medium">
                  {outgoing === null
                    ? `Saison ${saisonId} wird sofort öffentlich als laufende Saison angezeigt.`
                    : `Saison ${outgoing} wird abgeschlossen und ${saisonId} sofort öffentlich als laufende Saison angezeigt.`}{" "}
                  Rückgängig geht das nur, indem Du die andere Saison wieder umstellst.
                </p>
              </div>
            )}

            {/* Disabled rather than left live to fail. The endpoint refuses the same thing
                (`REQ-ACTIVATE-001`) and stays the authority — this only stops the page offering an act it
                knows the answer to, which is the same division the season form's rules panel makes. The
                list above is what makes the disabled state actionable. */}
            <div className="flex w-full flex-row flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="primary"
                isDisabled={isActivating || isBlocked}
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
