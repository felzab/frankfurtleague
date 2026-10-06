"use client";

import { useState } from "react";

import { KONTAKT_EMAIL } from "@/core/brand";
import { ABSATZ_CLASSES, Wert } from "@/features/bewerbungen/components/ui/Gefuellt";
import { SEITE_CLASSES } from "@/features/bewerbungen/components/ui/seite";
import { BEWERBUNG_BESTAETIGUNG_FRIST_TAGE, rollenLangform } from "@/features/bewerbungen/constants";
import { SaisonChip } from "@/features/saisons/components/ui/SaisonChip";
import { DISPLAY_HEADING_CLASSES } from "@/shared/components/ui/displayType";
import { formatSpielDatum } from "@/shared/utils/format";

import { BestaetigungFormPanel } from "./BestaetigungFormPanel";
import {
  AdresseGesperrt,
  BestaetigungErgebnis,
  FaktenBanner,
  FrageStellen,
  GespeicherteAngaben,
  LINK_UNLESBAR_TITEL,
  LinkUnlesbar,
  medienZeile,
  useLinkSeite,
  ZurLiga,
} from "./BestaetigungPanels";
import { BestaetigungSaisonVorbei } from "./BestaetigungSaisonVorbei";

import type { EinwilligungGeoeffnet, EinwilligungQuelle, LinkZustand } from "@/features/bewerbungen/types";
import type { BestaetigungAbschluss } from "./BestaetigungFormPanel";
import type { KontaktFassung } from "./BestaetigungHinweise";

/**
 * What the page opens on. The token rides only with a link a press can still spend: every other
 * state is a panel that names nobody, and a dead link handed onward identifies nobody either.
 */
export type BestaetigungStart =
  | { zustand: "gueltig"; ansicht: EinwilligungGeoeffnet; token: string; fassung: KontaktFassung }
  | { zustand: "saison_vorbei"; ansicht: EinwilligungGeoeffnet; token: string }
  | { zustand: LinkZustand | "unlesbar"; quelle?: EinwilligungQuelle };

type Stand =
  | BestaetigungStart
  | { zustand: "erfolg"; ansicht: EinwilligungGeoeffnet; geburtsdatum: string | null; whatsapp: boolean; medien: boolean }
  | { zustand: "widersprochen-neu"; ansicht: EinwilligungGeoeffnet };

/** One heading per state, uppercased by the page rather than typed so, as the application page does it. A barred link's page has none. */
const TITEL: Record<Exclude<Stand["zustand"], "gesperrt">, string> = {
  gueltig: "Eintrag bestätigen",
  erfolg: "Eintrag bestätigt",
  "widersprochen-neu": "Widerspruch gespeichert",
  saison_vorbei: "Bestätigen nicht mehr möglich",
  bestaetigt: "Schon erledigt",
  abgelehnt: "Schon erledigt",
  abgelaufen: "Link ungültig",
  ungueltig: "Link ungültig",
  unlesbar: LINK_UNLESBAR_TITEL,
};

/** Every seat one answer on this link writes, so the page names the reader what the mail that brought them here named them. */
const linkRollen = ({ rolle, zugleich_rolle }: EinwilligungGeoeffnet): string => rollenLangform([rolle, zugleich_rolle]);

/** The press's answer folded into the page's state, carrying the read that the panel still names the person from. */
function nachAntwort(abschluss: BestaetigungAbschluss, ansicht: EinwilligungGeoeffnet, token: string): Stand {
  if (abschluss.zustand === "erfolg") return { ...abschluss, ansicht: ansicht };
  if (abschluss.zustand === "widersprochen-neu") return { zustand: "widersprochen-neu", ansicht: ansicht };
  // The season closed between the open and the press: the token still takes a Widerspruch.
  if (abschluss.zustand === "saison_vorbei") return { zustand: "saison_vorbei", ansicht: ansicht, token: token };

  // The read that opened the page knew the record, which the spent link's panel words itself by.
  return { zustand: abschluss.zustand, quelle: ansicht.quelle };
}

/** Whether the page is about a seat an administrator typed onto a team's season row, which no application stands behind. */
function istSaison(stand: Stand): boolean {
  return "ansicht" in stand ? stand.ansicht.quelle === "saison" : "quelle" in stand && stand.quelle === "saison";
}

/** Which states know a season, and so may wear the chip the public pages head a season's page with. */
function saisonVon(stand: Stand): string | null {
  return "ansicht" in stand ? stand.ansicht.saison_id : null;
}

/**
 * One page for every state a link can be in, framed by the site's own navbar and footer: a contact
 * opening the link on a phone lands on the site the email named.
 */
export function BestaetigungView({ start }: { start: BestaetigungStart }) {
  const [stand, setStand] = useState<Stand>(start);
  const { ergebnisRef, beantwortet } = useLinkSeite(stand.zustand);

  if (stand.zustand === "gesperrt") return <AdresseGesperrt panelRef={ergebnisRef} />;

  const saison = saisonVon(stand);
  const saisonRow = istSaison(stand);

  return (
    <section className={SEITE_CLASSES}>
      <header className="flex w-full flex-col gap-3">
        {/* No dot: the link's read carries the season's id and never its status, so the page cannot say it is running. */}
        {saison !== null && <SaisonChip isLaufend={false}>Saison {saison}</SaisonChip>}
        <h1 className={`${DISPLAY_HEADING_CLASSES} fluid-3xl`}>{TITEL[stand.zustand]}</h1>

        {/* The facts the mail led with, in the mail's own panel: standing in a sentence under the
            heading they were what a reader skimmed past on the way to the button. */}
        {stand.zustand === "gueltig" && (
          <FaktenBanner
            zeilen={[
              // A season row's seat is entered for a team, which its stamped words and its mail call it.
              { label: saisonRow ? "Team" : "Schule", wert: stand.ansicht.schule, unbegrenzt: true },
              { label: "Saison", wert: stand.ansicht.saison_id },
              { label: "Deine Rolle", wert: linkRollen(stand.ansicht) },
            ]}
          />
        )}
        {/* Said here because the stamped wording cannot say it: one press confirms both seats, and a
            Widerspruch empties both. */}
        {stand.zustand === "gueltig" && stand.ansicht.zugleich_rolle !== null && (
          <p className={ABSATZ_CLASSES}>
            {saisonRow ? "Du bist für dieses Team zweimal eingetragen" : "Du bist in dieser Bewerbung zweimal eingetragen"}, und Deine Antwort
            gilt für beide Einträge.
          </p>
        )}
      </header>

      {stand.zustand === "gueltig" && (
        <BestaetigungFormPanel
          fassung={stand.fassung}
          token={stand.token}
          vorname={stand.ansicht.vorname}
          schule={stand.ansicht.schule}
          saison={stand.ansicht.saison_id}
          rolle={linkRollen(stand.ansicht)}
          istSaison={saisonRow}
          mindestalter={stand.ansicht.mindestalter}
          medienMindestalter={stand.ansicht.medien_mindestalter}
          onAbschluss={(abschluss) => {
            beantwortet();
            setStand(nachAntwort(abschluss, stand.ansicht, stand.token));
          }}
        />
      )}

      {stand.zustand === "saison_vorbei" && (
        <BestaetigungSaisonVorbei
          ansicht={stand.ansicht}
          token={stand.token}
          onAbschluss={(abschluss) => {
            beantwortet();
            setStand(nachAntwort(abschluss, stand.ansicht, stand.token));
          }}
        />
      )}

      {stand.zustand === "erfolg" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="erfolg">
          <p className={ABSATZ_CLASSES}>
            Danke, <Wert>{stand.ansicht.vorname}</Wert>.{" "}
            {stand.ansicht.zugleich_rolle === null ? (
              <>
                Dein Eintrag für {saisonRow ? "das Team" : "die Schule"} <Wert>{stand.ansicht.schule}</Wert> ist bestätigt.
              </>
            ) : (
              <>
                Deine beiden Einträge für {saisonRow ? "das Team" : "die Schule"} <Wert>{stand.ansicht.schule}</Wert> sind bestätigt.
              </>
            )}
          </p>
          {/* What the press stored and nothing the reader already knows: the school, the season and
              the seat are what they just confirmed, and the heading above says they did. */}
          <GespeicherteAngaben
            zeilen={[
              { label: "Geburtsdatum", wert: formatSpielDatum(stand.geburtsdatum) },
              { label: "WhatsApp", wert: stand.whatsapp ? "erlaubt" : "nicht erlaubt" },
              medienZeile(stand.medien),
            ]}
          />
          <p className={ABSATZ_CLASSES}>
            {saisonRow
              ? "Du musst nichts weiter tun."
              : "Sobald alle Kontaktpersonen bestätigt haben, ist die Bewerbung vollständig, und die Person, die sie eingereicht hat, bekommt eine E-Mail. Du musst nichts weiter tun."}
          </p>
          <p className={ABSATZ_CLASSES}>Fragen, Löschung und Widerspruch jederzeit per E-Mail an {KONTAKT_EMAIL}.</p>
          <ZurLiga />
        </BestaetigungErgebnis>
      )}

      {stand.zustand === "widersprochen-neu" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="erfolg">
          <p className={ABSATZ_CLASSES}>
            Danke für Deine Antwort, <Wert>{stand.ansicht.vorname}</Wert>.{" "}
            {saisonRow
              ? "Deine Angaben haben wir aus dem Eintrag entfernt."
              : "Deine Angaben haben wir aus der Bewerbung entfernt und der Person Bescheid gesagt, die sie eingereicht hat."}
          </p>
          <p className={ABSATZ_CLASSES}>
            {saisonRow
              ? "Falls Du es Dir anders überlegst, kann die Verwaltung der Liga Dich wieder eintragen. Du bekommst dann eine neue E-Mail."
              : "Falls Du es Dir anders überlegst, kann Deine Schule Dich in einer neuen Bewerbung wieder eintragen. Du bekommst dann eine neue E-Mail."}
          </p>
          <ZurLiga />
        </BestaetigungErgebnis>
      )}

      {/* No name and no school from here on: a consumed or dead link may have been forwarded, and a
          dead link identifies nobody. */}
      {stand.zustand === "bestaetigt" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="erfolg">
          <p className={ABSATZ_CLASSES}>Dieser Eintrag ist schon bestätigt. Du musst nichts weiter tun.</p>
          <p className={ABSATZ_CLASSES}>Fragen, Löschung und Widerspruch jederzeit per E-Mail an {KONTAKT_EMAIL}.</p>
          <ZurLiga />
        </BestaetigungErgebnis>
      )}

      {stand.zustand === "abgelehnt" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="erfolg">
          <p className={ABSATZ_CLASSES}>
            Über diesen Link wurde dem Eintrag schon widersprochen. Die Angaben sind aus {saisonRow ? "dem Eintrag" : "der Bewerbung"} entfernt,
            und Du musst nichts weiter tun.
          </p>
          <ZurLiga />
        </BestaetigungErgebnis>
      )}

      {/* One wording for both: after the deletion the record is gone and the two cannot be told
          apart, and telling them apart would tell a guessed link that a record once existed. */}
      {(stand.zustand === "abgelaufen" || stand.zustand === "ungueltig") && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="hinweis">
          {/* No application stands behind a season row's seat, so nothing is deleted with one, and only the administration re-sends its link. */}
          {saisonRow ? (
            <p className={ABSATZ_CLASSES}>
              Dieser Link ist ungültig oder abgelaufen. Ein Link gilt {String(BEWERBUNG_BESTAETIGUNG_FRIST_TAGE)} Tage. Einen neuen Link schickt
              Dir die Verwaltung der Liga auf Wunsch.
            </p>
          ) : (
            <>
              <p className={ABSATZ_CLASSES}>
                Dieser Link ist ungültig oder abgelaufen. Ein Link gilt {String(BEWERBUNG_BESTAETIGUNG_FRIST_TAGE)} Tage. Eine Bewerbung, die
                bis dahin nicht alle Bestätigungen hat, löschen wir mit allen Angaben.
              </p>
              <p className={ABSATZ_CLASSES}>Wird Deine Schule neu eingetragen, bekommst Du eine neue E-Mail mit einem neuen Link.</p>
            </>
          )}
          <FrageStellen />
        </BestaetigungErgebnis>
      )}

      {stand.zustand === "unlesbar" && <LinkUnlesbar panelRef={ergebnisRef} />}
    </section>
  );
}
