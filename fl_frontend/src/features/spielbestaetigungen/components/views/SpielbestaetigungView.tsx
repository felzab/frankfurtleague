"use client";

import { useState } from "react";

import { ABSATZ_CLASSES, Wert } from "@/features/bewerbungen/components/ui/Gefuellt";
import { SEITE_CLASSES } from "@/features/bewerbungen/components/ui/seite";
import {
  AdresseGesperrt,
  BestaetigungErgebnis,
  FaktenBanner,
  FrageStellen,
  GespeicherteAngaben,
  LINK_UNLESBAR_TITEL,
  LinkUnlesbar,
  useLinkSeite,
  ZurLiga,
} from "@/features/bewerbungen/components/views/BestaetigungPanels";
import { beantwortetVon, terminText } from "@/features/spielbestaetigungen/utils";
import { DISPLAY_HEADING_CLASSES } from "@/shared/components/ui/displayType";
import { formatSpielDatum, formatUhrzeit, NICHT_HINTERLEGT } from "@/shared/utils/format";

import { SpielbestaetigungFormPanel } from "./SpielbestaetigungFormPanel";

import type {
  FLSpielbestaetigungAnsichtResponse,
  FLSpielbestaetigungTermin,
  FLSpielbestaetigungVon,
} from "@/features/spielbestaetigungen/schemas";
import type { SpielbestaetigungLinkZustand } from "@/features/spielbestaetigungen/utils";
import type { SpielbestaetigungAbschluss } from "./SpielbestaetigungFormPanel";

/**
 * What the page opens on. The token rides only with a link a press can still spend: every other
 * state is a panel that names no fixture, and an answered one the seat that answered alone.
 */
export type SpielbestaetigungStart =
  | { zustand: "gueltig"; ansicht: FLSpielbestaetigungAnsichtResponse; token: string }
  | { zustand: "vorschlag"; ansicht: FLSpielbestaetigungAnsichtResponse; token: string }
  | { zustand: "zugesagt"; beantwortet_von: FLSpielbestaetigungVon }
  | { zustand: "abgelehnt"; beantwortet_von: FLSpielbestaetigungVon }
  | { zustand: Exclude<SpielbestaetigungLinkZustand, "zugesagt" | "abgelehnt"> | "unlesbar" };

type Stand =
  | SpielbestaetigungStart
  | { zustand: "zugesagt-neu"; ansicht: FLSpielbestaetigungAnsichtResponse }
  | { zustand: "abgelehnt-neu"; ansicht: FLSpielbestaetigungAnsichtResponse; vorschlag: FLSpielbestaetigungTermin };

/** One heading per state, in the other link pages' words where the state is theirs. A barred link's page has none. */
const TITEL: Record<Exclude<Stand["zustand"], "gesperrt">, string> = {
  gueltig: "Spieltermin bestätigen",
  vorschlag: "Spieltermin bestätigen",
  "zugesagt-neu": "Termin bestätigt",
  "abgelehnt-neu": "Vorschlag gesendet",
  zugesagt: "Schon erledigt",
  abgelehnt: "Schon erledigt",
  abgelaufen: "Link ungültig",
  "termin-vorbei": "Link ungültig",
  ungueltig: "Link ungültig",
  abgesagt: "Spiel abgesagt",
  unlesbar: LINK_UNLESBAR_TITEL,
};

/** The two clubs, ours first: the page is the reader's club's answer about its own fixture. */
function vereine(ansicht: FLSpielbestaetigungAnsichtResponse): { eigenes: string; anderes: string } {
  const { team1_name, team2_name } = ansicht.ansetzung;
  return ansicht.seite === "team1" ? { eigenes: team1_name, anderes: team2_name } : { eigenes: team2_name, anderes: team1_name };
}

/** The fixture as the mail led with it, in the mail's own panel. */
function Ansetzung({ ansicht }: { ansicht: FLSpielbestaetigungAnsichtResponse }) {
  const { ansetzung } = ansicht;
  return (
    <FaktenBanner
      zeilen={[
        { label: "Spiel", wert: `${ansetzung.team1_name} gegen ${ansetzung.team2_name}`, unbegrenzt: true },
        { label: "Datum", wert: formatSpielDatum(ansetzung.datum) },
        { label: "Anpfiff", wert: formatUhrzeit(ansetzung.uhrzeit) },
        { label: "Spielort", wert: ansetzung.spielort?.name ?? NICHT_HINTERLEGT },
      ]}
    />
  );
}

/** The press's answer folded into the page's state, carrying the read the receipt still names the fixture from. */
function nachAntwort(abschluss: SpielbestaetigungAbschluss, ansicht: FLSpielbestaetigungAnsichtResponse): Stand {
  if (abschluss.zustand === "zugesagt-neu") return { zustand: "zugesagt-neu", ansicht: ansicht };
  if (abschluss.zustand === "abgelehnt-neu") return { zustand: "abgelehnt-neu", ansicht: ansicht, vorschlag: abschluss.vorschlag };
  // The link died between the open and the press: its panel names the fixture no more than a fresh open would.
  return abschluss;
}

/**
 * **It names no person** (`docs/frontend/spec.md :: I737`): a link may sit in a mailbox an administrator
 * typed wrong, so the page serves the clubs, the fixture, the deadline, a proposal and the answering seat.
 */
export function SpielbestaetigungView({ start }: { start: SpielbestaetigungStart }) {
  const [stand, setStand] = useState<Stand>(start);
  const { ergebnisRef, beantwortet } = useLinkSeite(stand.zustand);

  if (stand.zustand === "gesperrt") return <AdresseGesperrt panelRef={ergebnisRef} />;

  return (
    <section className={SEITE_CLASSES}>
      <header className="flex w-full flex-col gap-3">
        <h1 className={`${DISPLAY_HEADING_CLASSES} fluid-3xl`}>{TITEL[stand.zustand]}</h1>

        {(stand.zustand === "gueltig" || stand.zustand === "vorschlag") && (
          <>
            <Ansetzung ansicht={stand.ansicht} />
            <p className={ABSATZ_CLASSES}>
              Du antwortest für <Wert>{vereine(stand.ansicht).eigenes}</Wert>. Antworte bis zum {formatSpielDatum(stand.ansicht.frist)}. Danach
              legt die Verwaltung der Liga den Termin fest.
            </p>
          </>
        )}

        {/* The opponent's proposal and nothing of how they reasoned it: the reader still answers the date standing. */}
        {stand.zustand === "vorschlag" && stand.ansicht.vorschlag !== null && (
          <p className={ABSATZ_CLASSES}>
            <Wert>{vereine(stand.ansicht).anderes}</Wert> hat einen anderen Termin vorgeschlagen: {terminText(stand.ansicht.vorschlag)}. Über
            eine Verlegung entscheidet die Liga. Bis dahin gilt der Termin oben.
          </p>
        )}
      </header>

      {(stand.zustand === "gueltig" || stand.zustand === "vorschlag") && (
        <SpielbestaetigungFormPanel
          token={stand.token}
          onAbschluss={(abschluss) => {
            beantwortet();
            setStand(nachAntwort(abschluss, stand.ansicht));
          }}
        />
      )}

      {stand.zustand === "zugesagt-neu" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="erfolg">
          <p className={ABSATZ_CLASSES}>
            Danke. Für <Wert>{vereine(stand.ansicht).eigenes}</Wert> ist der Termin bestätigt.
          </p>
          <p className={ABSATZ_CLASSES}>Du musst nichts weiter tun. Wird das Spiel verlegt, kommt eine neue E-Mail.</p>
          <ZurLiga />
        </BestaetigungErgebnis>
      )}

      {stand.zustand === "abgelehnt-neu" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="erfolg">
          <p className={ABSATZ_CLASSES}>
            Danke. Dein Vorschlag für <Wert>{vereine(stand.ansicht).eigenes}</Wert> ist bei der Liga.
          </p>
          <GespeicherteAngaben
            zeilen={[
              { label: "Neues Datum", wert: formatSpielDatum(stand.vorschlag.datum) },
              { label: "Neuer Anpfiff", wert: formatUhrzeit(stand.vorschlag.uhrzeit) },
            ]}
          />
          <p className={ABSATZ_CLASSES}>Über den Termin entscheidet die Liga. Wird das Spiel verlegt, kommt eine neue E-Mail.</p>
          <ZurLiga />
        </BestaetigungErgebnis>
      )}

      {/* No club and no date from here on: an answered link may have been forwarded, and names the seat alone. */}
      {stand.zustand === "zugesagt" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="erfolg">
          {/* The league's own entry once the deadline passed is no answer of the team's, and says so beside the readout. */}
          <p className={ABSATZ_CLASSES}>
            {stand.beantwortet_von.art === "admin"
              ? "Für dieses Spiel hat die Verwaltung der Liga den Termin für Dein Team bestätigt. Du musst nichts weiter tun."
              : "Für dieses Spiel hat Dein Team schon zugesagt. Du musst nichts weiter tun."}
          </p>
          <GespeicherteAngaben zeilen={[{ label: "Zugesagt von", wert: beantwortetVon(stand.beantwortet_von) }]} />
          <ZurLiga />
        </BestaetigungErgebnis>
      )}

      {stand.zustand === "abgelehnt" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="erfolg">
          <p className={ABSATZ_CLASSES}>Für dieses Spiel hat Dein Team den Termin schon abgesagt. Über den Termin entscheidet die Liga.</p>
          <GespeicherteAngaben zeilen={[{ label: "Abgesagt von", wert: beantwortetVon(stand.beantwortet_von) }]} />
          <ZurLiga />
        </BestaetigungErgebnis>
      )}

      {/* One wording for both, though the view tells them apart: each sentence names one case's way on, and a guessed
          link, read `ungueltig`, passes for a real one before its day. A day gone by has the panel below. */}
      {(stand.zustand === "abgelaufen" || stand.zustand === "ungueltig") && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="hinweis">
          <p className={ABSATZ_CLASSES}>
            Dieser Link ist ungültig oder abgelaufen. Wurde das Spiel verlegt, kommt eine neue E-Mail mit dem neuen Termin. Ist die Frist
            vorbei, legt die Verwaltung der Liga den Termin fest.
          </p>
          <FrageStellen />
        </BestaetigungErgebnis>
      )}

      {/* Whatever the team answered: an agreement shown here would send it to a ground nobody plays on. */}
      {stand.zustand === "abgesagt" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="hinweis">
          <p className={ABSATZ_CLASSES}>
            Dieses Spiel ist abgesagt. Du musst nichts weiter tun. Wird es neu angesetzt, kommt eine neue E-Mail.
          </p>
          <ZurLiga />
        </BestaetigungErgebnis>
      )}

      {stand.zustand === "termin-vorbei" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="hinweis">
          <p className={ABSATZ_CLASSES}>Dieser Link ist abgelaufen: Der Spieltermin ist vorbei.</p>
          <FrageStellen />
        </BestaetigungErgebnis>
      )}

      {stand.zustand === "unlesbar" && <LinkUnlesbar panelRef={ergebnisRef} />}
    </section>
  );
}
