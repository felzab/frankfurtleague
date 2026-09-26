"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import ArrowRightArrowLeft from "@gravity-ui/icons/ArrowRightArrowLeft";

import { activateSaisonAction } from "@/features/saisons/actions";
import { SaisonBadge } from "@/features/saisons/components/ui/SaisonBadge";
import { SPIELTAGE_UNDATED } from "@/features/saisons/constants";
import { Callout } from "@/shared/components/ui/Callout";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { BRAND_INK_OUTSIDE_PROSE_CLASSES } from "@/shared/components/ui/textLink";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { rejectedWrite } from "@/shared/utils/actionError";
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
  const saisonHref = useSaisonHref();
  // Only a `future` season has an act on offer: the running season has nothing to switch to, and a
  // `past` one is refused by `REQ-ACTIVATE-002`.
  const panel = formPanel({ tone: saisonStatus === "future" ? "danger" : "neutral" });
  const twoPress = useTwoPressConfirm(onBeforeActivate);
  const router = useRouter();
  const { isConfirming, press } = twoPress;

  const isAlreadyActive = saisonStatus === "active";
  const isFinishedSaison = saisonStatus === "past";
  const offene = rollover.offeneSpiele;
  const outgoing = rollover.outgoingSaisonId;

  const blockedReason = rolloverBlockedReason({
    hasDrawnSpiele,
    hasUndatierteSpieltage: rollover.hasUndatierteSpieltage,
    outgoingSaisonId: outgoing,
    offeneSpieleCount: offene.length,
  });

  const handleActivate = () => {
    press(async () => {
      // A rejected action may still have saved, and uncaught here it takes the page down with it.
      const res = await activateSaisonAction({ id: saisonId }).catch(rejectedWrite(router));

      if (!res.success) {
        appToast.failure("Saison nicht umgestellt", res);
        return;
      }

      appToast.success("Saison umgestellt", { description: res.message });
    });
  };

  const restingLabel = `Auf Saison ${saisonId} umstellen`;

  return (
    <section className={panel.root()}>
      <div className={`${panel.header()} relative`}>
        <span className="absolute top-1/2 right-4 -translate-y-1/2 sm:right-5">
          <SaisonBadge status={saisonStatus} />
        </span>
        <PanelHeading
          className={panel.heading()}
          title="Umstellung">
          <Hint
            mode="reveal"
            label="Hinweis zur Umstellung"
            body={{
              lead: "Die Umstellung macht diese Saison zur laufenden Saison.",
              points: [{ term: "Die Spiele der alten Saison", text: "bleiben danach bearbeitbar." }],
            }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        {isFinishedSaison ? (
          // Closed rather than disabled with a hint: `REQ-ACTIVATE-002` has no remedy, and a hint
          // saying what would unblock it would name a route the system does not have.
          <Callout
            severity="info"
            title="Diese Saison ist abgeschlossen">
            Eine abgeschlossene Saison wird nicht wieder zur laufenden. Ihre Punkte, ihre Gruppen und ihre Tabelle halten fest, was gespielt
            wurde.
          </Callout>
        ) : isAlreadyActive ? (
          // Panel-local and deliberately not a banner: it answers "why can I not act HERE", which is a
          // question only this control raises.
          <Callout
            severity="info"
            title="Diese Saison ist aktiv">
            Umgestellt wird auf der Seite der geplanten Saison.
          </Callout>
        ) : (
          <>
            {/* The outgoing season, named rather than assumed: on a fresh database there is none, and a
                panel that spoke of "the previous season" regardless would be describing a document
                that does not exist. */}
            <p className="muted-hint">
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
                Eine Saison ohne Spiele wird nicht zur laufenden Saison. Lege den Spielplan im Abschnitt <strong>Spielplan</strong> an, dann
                lässt sich umstellen.
              </Callout>
            )}

            {/* Behind the draw, in `rolloverBlockedReason`'s order: an undrawn season holds no
                matchday to date, so both at once would name a repair nobody can make yet. */}
            {hasDrawnSpiele && rollover.hasUndatierteSpieltage && (
              <Callout
                severity="warning"
                title="Diese Saison hat Spieltage ohne Datum">
                {SPIELTAGE_UNDATED} Trage die Daten unter <strong>Spieltage</strong> ein.
              </Callout>
            )}

            {/* The list, not a number: a count tells the operator that something is open and
                nothing about whether it matters. A finale without a result is a different decision
                from four group games nobody waits on. */}
            {offene.length > 0 && (
              <ul className="flex w-full flex-col divide-y divide-border/50 rounded-xl border border-border">
                {offene.slice(0, LISTED_OFFENE_SPIELE).map((spiel) => (
                  <li
                    key={spiel.id}
                    className="flex w-full flex-row items-center gap-x-3 px-3 py-2">
                    <span className="flex h-6 min-w-8 shrink-0 items-center justify-center rounded-md bg-muted fluid-xxs font-extrabold text-foreground-muted">
                      {spiel.spielNr}
                    </span>
                    <span className="min-w-0 flex-1 truncate fluid-xs font-semibold text-foreground">{spiel.paarung}</span>
                    <span className="shrink-0 fluid-xxs text-foreground-muted">{formatSpielDatum(spiel.datum)}</span>
                    <Link
                      href={saisonHref(`/admin/spiele/${spiel.id}`)}
                      className={`${BRAND_INK_OUTSIDE_PROSE_CLASSES} shrink-0 fluid-xxs font-bold`}>
                      Öffnen
                    </Link>
                  </li>
                ))}
                {/* Singular and plural spelled out: a remainder of one makes "1 weitere" out of a fixed plural. */}
                {offene.length > LISTED_OFFENE_SPIELE && (
                  <li className="px-3 py-2 fluid-xxs font-medium text-foreground-muted">
                    {offene.length - LISTED_OFFENE_SPIELE === 1
                      ? "und ein weiteres."
                      : `und ${String(offene.length - LISTED_OFFENE_SPIELE)} weitere.`}{" "}
                    Die vollständige Liste steht unter Handlungsbedarf.
                  </li>
                )}
              </ul>
            )}

            {isConfirming && (
              <ConfirmReveal>
                {/* The finality is said on the outgoing branch alone: with nothing active this press
                    closes no season, and closing one is what `REQ-ACTIVATE-002` then refuses to undo. */}
                <p className="fluid-xxs leading-normal font-medium text-foreground">
                  {outgoing === null
                    ? `Saison ${saisonId} wird sofort öffentlich als laufende Saison angezeigt.`
                    : `Saison ${outgoing} ist danach abgeschlossen, und ${saisonId} wird sofort öffentlich als laufende Saison angezeigt. Es gibt in der Verwaltung keinen Weg zurück.`}
                </p>
              </ConfirmReveal>
            )}

            {/* Disabled rather than left live to fail: the endpoint refuses each of these itself
                and stays the authority, and this only stops the page offering an act it knows the
                answer to. */}
            <ConfirmActionRow confirm={twoPress}>
              {/* The body sits a screen away from the button, so the refusal is said again on the
                  control itself. */}
              <ConfirmPressButton
                confirm={twoPress}
                reason={blockedReason}
                resting={restingLabel}
                armed={`Ja, auf ${saisonId} umstellen`}
                running="Stellt um..."
                icon={
                  <ArrowRightArrowLeft
                    className="size-4.5"
                    aria-hidden="true"
                  />
                }
                onPress={handleActivate}
              />
            </ConfirmActionRow>
          </>
        )}
      </div>
    </section>
  );
}
