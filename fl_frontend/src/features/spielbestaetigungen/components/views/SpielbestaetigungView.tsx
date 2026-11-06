"use client";

import { useState } from "react";

import { PARAGRAPH_CLASSES, Value } from "@/features/bewerbungen/components/ui/Filled";
import { SEITE_CLASSES } from "@/features/bewerbungen/components/ui/seite";
import {
  AddressBarred,
  AskQuestion,
  ConfirmationResult,
  FactsBanner,
  LINK_UNREADABLE_TITLE,
  LinkUnreadable,
  SavedDetails,
  ToLiga,
  useLinkSeite,
} from "@/features/bewerbungen/components/views/ConfirmationPanels";
import { answeredBy, terminText } from "@/features/spielbestaetigungen/utils";
import { DISPLAY_HEADING_CLASSES } from "@/shared/components/ui/displayType";
import { formatSpielDatum, formatUhrzeit, NICHT_HINTERLEGT } from "@/shared/utils/format";

import { SpielbestaetigungFormPanel } from "./SpielbestaetigungFormPanel";

import type { FLSpielbestaetigungAppointment, FLSpielbestaetigungBy, FLSpielbestaetigungViewResponse } from "@/core/generated/client/types";
import type { SpielbestaetigungLinkZustand } from "@/features/spielbestaetigungen/utils";
import type { SpielbestaetigungAbschluss } from "./SpielbestaetigungFormPanel";

/**
 * What the page opens on. The token rides only with a link a press can still spend: every other
 * state is a panel that names no fixture, and an answered one the seat that answered alone.
 */
export type SpielbestaetigungStart =
  | { state: "valid"; ansicht: FLSpielbestaetigungViewResponse; token: string }
  | { state: "vorschlag"; ansicht: FLSpielbestaetigungViewResponse; token: string }
  | { state: "zugesagt"; answered_by: FLSpielbestaetigungBy }
  | { state: "declined"; answered_by: FLSpielbestaetigungBy }
  | { state: "discarded"; appointment: FLSpielbestaetigungAppointment }
  | { state: Exclude<SpielbestaetigungLinkZustand, "zugesagt" | "declined" | "discarded"> | "unlesbar" };

type Stand =
  | SpielbestaetigungStart
  | { state: "zugesagt-neu"; ansicht: FLSpielbestaetigungViewResponse }
  | { state: "abgelehnt-neu"; ansicht: FLSpielbestaetigungViewResponse; vorschlag: FLSpielbestaetigungAppointment };

/** One heading per state, in the other link pages' words where the state is theirs. A barred link's page has none. */
const TITEL: Record<Exclude<Stand["state"], "barred">, string> = {
  valid: "Spieltermin bestätigen",
  vorschlag: "Spieltermin bestätigen",
  "zugesagt-neu": "Termin bestätigt",
  "abgelehnt-neu": "Vorschlag gesendet",
  zugesagt: "Schon erledigt",
  declined: "Schon erledigt",
  discarded: "Schon erledigt",
  expired: "Link ungültig",
  "termin-vorbei": "Link ungültig",
  invalid: "Link ungültig",
  cancelled: "Spiel abgesagt",
  unlesbar: LINK_UNREADABLE_TITLE,
};

/** The two clubs, ours first: the page is the reader's club's answer about its own fixture. */
function vereine(view: FLSpielbestaetigungViewResponse): { eigenes: string; anderes: string } {
  const { team1_name, team2_name } = view.ansetzung;
  return view.side === "team1" ? { eigenes: team1_name, anderes: team2_name } : { eigenes: team2_name, anderes: team1_name };
}

/** The fixture as the mail led with it, in the mail's own panel. */
function Ansetzung({ ansicht }: { ansicht: FLSpielbestaetigungViewResponse }) {
  const { ansetzung } = ansicht;
  return (
    <FactsBanner
      rows={[
        { label: "Spiel", value: `${ansetzung.team1_name} vs. ${ansetzung.team2_name}`, unbounded: true },
        { label: "Datum", value: formatSpielDatum(ansetzung.date) },
        { label: "Anpfiff", value: formatUhrzeit(ansetzung.time) },
        { label: "Spielort", value: ansetzung.spielort?.name ?? NICHT_HINTERLEGT },
      ]}
    />
  );
}

/** The press's answer folded into the page's state, carrying the read the receipt still names the fixture from. */
function afterAnswer(abschluss: SpielbestaetigungAbschluss, view: FLSpielbestaetigungViewResponse): Stand {
  if (abschluss.state === "zugesagt-neu") return { state: "zugesagt-neu", ansicht: view };
  if (abschluss.state === "abgelehnt-neu") return { state: "abgelehnt-neu", ansicht: view, vorschlag: abschluss.vorschlag };
  // The link died between the open and the press: its panel names the fixture no more than a fresh open would.
  return abschluss;
}

/**
 * **It names no person**: a link may sit in a mailbox an administrator
 * typed wrong, so the page serves the clubs, the fixture, the deadline, a proposal and the answering seat.
 */
export function SpielbestaetigungView({ start }: { start: SpielbestaetigungStart }) {
  const [stand, setStand] = useState<Stand>(start);
  const { ergebnisRef, answered } = useLinkSeite(stand.state);

  if (stand.state === "barred") return <AddressBarred panelRef={ergebnisRef} />;

  return (
    <section className={SEITE_CLASSES}>
      <header className="flex w-full flex-col gap-3">
        <h1 className={`${DISPLAY_HEADING_CLASSES} fluid-3xl`}>{TITEL[stand.state]}</h1>

        {(stand.state === "valid" || stand.state === "vorschlag") && (
          <>
            <Ansetzung ansicht={stand.ansicht} />
            <p className={PARAGRAPH_CLASSES}>
              Du antwortest für <Value>{vereine(stand.ansicht).eigenes}</Value>. Antworte bis zum {formatSpielDatum(stand.ansicht.deadline)}.
              Danach legt die Verwaltung der Liga den Termin fest.
            </p>
          </>
        )}

        {/* The opponent's proposal and nothing of how they reasoned it: the reader still answers the date standing. */}
        {stand.state === "vorschlag" && stand.ansicht.vorschlag !== null && (
          <p className={PARAGRAPH_CLASSES}>
            <Value>{vereine(stand.ansicht).anderes}</Value> hat einen anderen Termin vorgeschlagen: {terminText(stand.ansicht.vorschlag)}. Über
            eine Verlegung entscheidet die Liga. Bis dahin gilt der Termin oben.
          </p>
        )}
      </header>

      {(stand.state === "valid" || stand.state === "vorschlag") && (
        <SpielbestaetigungFormPanel
          token={stand.token}
          onAbschluss={(abschluss) => {
            answered();
            setStand(afterAnswer(abschluss, stand.ansicht));
          }}
        />
      )}

      {stand.state === "zugesagt-neu" && (
        <ConfirmationResult
          panelRef={ergebnisRef}
          tone="success">
          <p className={PARAGRAPH_CLASSES}>
            Danke. Für <Value>{vereine(stand.ansicht).eigenes}</Value> ist der Termin bestätigt.
          </p>
          <p className={PARAGRAPH_CLASSES}>Du musst nichts weiter tun. Wird das Spiel verlegt, kommt eine neue E-Mail.</p>
          <ToLiga />
        </ConfirmationResult>
      )}

      {stand.state === "abgelehnt-neu" && (
        <ConfirmationResult
          panelRef={ergebnisRef}
          tone="success">
          <p className={PARAGRAPH_CLASSES}>
            Danke. Dein Vorschlag für <Value>{vereine(stand.ansicht).eigenes}</Value> ist bei der Liga.
          </p>
          <SavedDetails
            rows={[
              { label: "Neues Datum", value: formatSpielDatum(stand.vorschlag.date) },
              { label: "Neuer Anpfiff", value: formatUhrzeit(stand.vorschlag.time) },
            ]}
          />
          <p className={PARAGRAPH_CLASSES}>Über den Termin entscheidet die Liga. Wird das Spiel verlegt, kommt eine neue E-Mail.</p>
          <ToLiga />
        </ConfirmationResult>
      )}

      {/* No club and no date from here on: an answered link may have been forwarded, and names the seat alone. */}
      {stand.state === "zugesagt" && (
        <ConfirmationResult
          panelRef={ergebnisRef}
          tone="success">
          {/* The league's own entry once the deadline passed is no answer of the team's, and says so beside the readout. */}
          <p className={PARAGRAPH_CLASSES}>
            {stand.answered_by.kind === "admin"
              ? "Für dieses Spiel hat die Verwaltung der Liga den Termin für Dein Team bestätigt. Du musst nichts weiter tun."
              : "Für dieses Spiel hat Dein Team schon zugesagt. Du musst nichts weiter tun."}
          </p>
          <SavedDetails rows={[{ label: "Zugesagt von", value: answeredBy(stand.answered_by) }]} />
          <ToLiga />
        </ConfirmationResult>
      )}

      {stand.state === "declined" && (
        <ConfirmationResult
          panelRef={ergebnisRef}
          tone="success">
          <p className={PARAGRAPH_CLASSES}>Für dieses Spiel hat Dein Team den Termin schon abgesagt. Über den Termin entscheidet die Liga.</p>
          <SavedDetails rows={[{ label: "Abgesagt von", value: answeredBy(stand.answered_by) }]} />
          <ToLiga />
        </ConfirmationResult>
      )}

      {/* The decline's own sentence said the league decides, so this one says it has, under the date it kept. */}
      {stand.state === "discarded" && (
        <ConfirmationResult
          panelRef={ergebnisRef}
          tone="success">
          <SavedDetails rows={[{ label: "Termin", value: terminText(stand.appointment) }]} />
          <p className={PARAGRAPH_CLASSES}>Die Liga hat entschieden: Der Termin oben bleibt.</p>
          <ToLiga />
        </ConfirmationResult>
      )}

      {/* One wording for both, though the view tells them apart: each sentence names one case's way on, and a guessed
          link, read `ungueltig`, passes for a real one before its day. A day gone by has the panel below. */}
      {(stand.state === "expired" || stand.state === "invalid") && (
        <ConfirmationResult
          panelRef={ergebnisRef}
          tone="notice">
          <p className={PARAGRAPH_CLASSES}>
            Dieser Link ist ungültig oder abgelaufen. Wurde das Spiel verlegt, kommt eine neue E-Mail mit dem neuen Termin. Ist die Frist
            vorbei, legt die Verwaltung der Liga den Termin fest.
          </p>
          <AskQuestion />
        </ConfirmationResult>
      )}

      {/* Whatever the team answered: an agreement shown here would send it to a ground nobody plays on. */}
      {stand.state === "cancelled" && (
        <ConfirmationResult
          panelRef={ergebnisRef}
          tone="notice">
          <p className={PARAGRAPH_CLASSES}>
            Dieses Spiel ist abgesagt. Du musst nichts weiter tun. Wird es neu angesetzt, kommt eine neue E-Mail.
          </p>
          <ToLiga />
        </ConfirmationResult>
      )}

      {stand.state === "termin-vorbei" && (
        <ConfirmationResult
          panelRef={ergebnisRef}
          tone="notice">
          <p className={PARAGRAPH_CLASSES}>Dieser Link ist abgelaufen: Der Spieltermin ist vorbei.</p>
          <AskQuestion />
        </ConfirmationResult>
      )}

      {stand.state === "unlesbar" && <LinkUnreadable panelRef={ergebnisRef} />}
    </section>
  );
}
