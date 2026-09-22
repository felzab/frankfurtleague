"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { ABSATZ, BestaetigungErgebnis, FaktenBanner, FrageStellen, Wert } from "@/features/bewerbungen/components/views/BestaetigungPanels";
import { SaisonChip } from "@/features/saisons/components/ui/SaisonChip";
import { DISPLAY_HEADING } from "@/shared/components/ui/displayType";
import { textLink } from "@/shared/components/ui/textLink";

import { formularZustand } from "../../utils";
import { RegistrierungFormPanel } from "./RegistrierungFormPanel";

import type { FLEinladungAnsichtResponse } from "../../schemas";
import type { RegistrierungStart } from "../../types";

/**
 * Which state the page renders.
 *
 * Three of them close the form rather than offering it over a refusal, which
 * `.claude/rules/cross-surface.md`'s **saisons** clause bans.
 */
type Stand = "gueltig" | "kader-voll" | "team-fehlt" | "geschlossen" | "ungueltig" | "unlesbar";

/** One heading per state, uppercased by the page rather than typed so, as the application page does it. */
const TITEL: Record<Stand, string> = {
  gueltig: "Für Dein Team registrieren",
  "kader-voll": "Kader voll",
  "team-fehlt": "Team nicht eingetragen",
  geschlossen: "Registrierung geschlossen",
  ungueltig: "Link ungültig",
  unlesbar: "Link nicht geprüft",
};

/** The application page's own column, so the two public forms are one page wide. */
const SEITE = "max-w-meta flex w-full flex-col gap-6 px-3 pt-4 pb-10 sm:px-6 lg:px-8 lg:pt-8";

/** What the page knows about the team, or `null` where it may name nobody. */
type Geoeffnet = { stand: Stand; ansicht: FLEinladungAnsichtResponse | null };

// Derived TOGETHER, so no state can render a heading of one kind over a team banner of another: the
// dead-link arm is reached by a write refusing after the page opened, with the read's answer still
// in hand.
function standVon(start: RegistrierungStart, istTot: boolean): Geoeffnet {
  if (istTot) return { stand: "ungueltig", ansicht: null };
  if (start.zustand === "ungueltig" || start.zustand === "unlesbar") return { stand: start.zustand, ansicht: null };

  return { stand: formularZustand(start.ansicht), ansicht: start.ansicht };
}

/**
 * One page for every state an invite can be in, framed by the site's own navbar and footer: a pupil
 * opening the link on a phone lands on the site their team's message named.
 */
export function RegistrierungView({ start }: { start: RegistrierungStart }) {
  const [istTot, setIstTot] = useState(false);
  const { stand, ansicht } = standVon(start, istTot);

  useEffect(() => {
    // The bare path after hydration, so the address bar, a screenshot and a bookmark carry no token.
    // Not while the read failed: a reload is the way back, and it needs the token in the URL.
    if (stand === "unlesbar" || window.location.search === "") return;
    window.history.replaceState(null, "", window.location.pathname);
  }, [stand]);

  return (
    <section className={SEITE}>
      <header className="flex w-full flex-col gap-3">
        {/* No dot: the invite's read carries the season's id and its status, and „läuft“ on the chip
            is a claim about the season rather than about the registration window. */}
        {ansicht !== null && <SaisonChip isLaufend={false}>Saison {ansicht.saison_id}</SaisonChip>}
        <h1 className={`${DISPLAY_HEADING} fluid-3xl`}>{TITEL[stand]}</h1>

        {ansicht !== null && (
          <FaktenBanner
            zeilen={[
              { label: "Team", wert: ansicht.team },
              { label: "Schule", wert: ansicht.schule, unbegrenzt: true },
              { label: "Saison", wert: ansicht.saison_id },
            ]}
          />
        )}

        {/* Said before anything is typed, because it changes what the registration means rather than
            whether it is accepted: the squad's own entries closed when the first matchday began. */}
        {stand === "gueltig" && ansicht !== null && ansicht.nachnominierung && (
          <p className={ABSATZ}>
            Die Saison hat schon begonnen. Du wirst deshalb <Wert>nachnominiert</Wert>. Am Mitspielen ändert das nichts.
          </p>
        )}

        {stand === "gueltig" && (
          <p className={ABSATZ}>
            Was mit Deinen Angaben passiert, steht in der{" "}
            <Link
              href="/datenschutz"
              prefetch={false}
              className={textLink()}>
              Datenschutzerklärung
            </Link>
            .
          </p>
        )}
      </header>

      {stand === "gueltig" && start.zustand === "gueltig" && (
        <RegistrierungFormPanel
          token={start.token}
          ansicht={start.ansicht}
          onLinkTot={() => setIstTot(true)}
        />
      )}

      {stand === "kader-voll" && (
        <BestaetigungErgebnis tone="hinweis">
          <p className={ABSATZ}>
            Der Kader dieses Teams ist für diese Saison voll, deshalb können wir gerade keine weitere Registrierung annehmen.
          </p>
          <p className={ABSATZ}>Sag Deinem Team Bescheid. Wird im Kader wieder ein Platz frei, kannst Du den Link erneut öffnen.</p>
          <FrageStellen />
        </BestaetigungErgebnis>
      )}

      {/* The season's own list and nothing a pupil can act on alone, so the sentence sends them to
          the one place that can repair it and says nothing about why the team is missing. */}
      {stand === "team-fehlt" && (
        <BestaetigungErgebnis tone="hinweis">
          <p className={ABSATZ}>Dieses Team spielt in dieser Saison nicht mit, deshalb können wir für den Link keine Registrierung annehmen.</p>
          <p className={ABSATZ}>Frag in Deinem Team nach. Sobald es eingetragen ist, funktioniert derselbe Link.</p>
          <FrageStellen />
        </BestaetigungErgebnis>
      )}

      {/* „geschlossen“ and never „ungültig“: an invite pasted after the window shut is a working link
          whose season is over, and a reader told otherwise goes away believing their team misled them. */}
      {stand === "geschlossen" && (
        <BestaetigungErgebnis tone="hinweis">
          <p className={ABSATZ}>Für diese Saison ist die Registrierung geschlossen. Der Link Deines Teams funktioniert, das Fenster nicht.</p>
          <p className={ABSATZ}>Zur nächsten Saison öffnet die Registrierung wieder, und Dein Team bekommt dafür einen neuen Link.</p>
          <FrageStellen />
        </BestaetigungErgebnis>
      )}

      {/* No team and no school from here on: a dead link may have been forwarded, and it identifies
          nobody. */}
      {stand === "ungueltig" && (
        <BestaetigungErgebnis tone="hinweis">
          <p className={ABSATZ}>Dieser Link gilt nicht mehr. Dein Team hat ihn entweder ersetzt, oder er war nie vollständig.</p>
          <p className={ABSATZ}>Frag in Deinem Team nach dem aktuellen Link.</p>
          <FrageStellen />
        </BestaetigungErgebnis>
      )}

      {/* Says that it does not know, and nothing else: folded into the dead-link panel, this arm would
          call a live link void on a day the backend was merely unreachable. */}
      {stand === "unlesbar" && (
        <BestaetigungErgebnis tone="hinweis">
          <p className={ABSATZ}>Wir können diesen Link gerade nicht prüfen. Lade die Seite in ein paar Minuten neu, oder schreib uns.</p>
          <FrageStellen />
        </BestaetigungErgebnis>
      )}
    </section>
  );
}
