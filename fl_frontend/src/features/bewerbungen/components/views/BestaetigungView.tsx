"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { KONTAKT_EMAIL, VEREIN_ANSCHRIFT, VEREIN_NAME } from "@/core/brand";
import { BEWERBUNG_BESTAETIGUNG_FRIST_TAGE } from "@/features/bewerbungen/constants";
import { SaisonChip } from "@/features/saisons/components/ui/SaisonChip";
import { KONTAKT_ROLLEN } from "@/features/teams/constants";
import { ctaButton } from "@/shared/components/ui/formButtons";
import { textLink } from "@/shared/components/ui/textLink";
import { formatSpielDatum } from "@/shared/utils/format";

import { BestaetigungFormPanel } from "./BestaetigungFormPanel";
import { BestaetigungErgebnis, Fakten, Wert } from "./BestaetigungPanels";

import type { EinwilligungGeoeffnet, LinkZustand } from "@/features/bewerbungen/types";
import type { KontaktRolle } from "@/features/teams/constants";
import type { ReactNode } from "react";
import type { BestaetigungAbschluss } from "./BestaetigungFormPanel";

/**
 * What the page opens on. The token rides only with a link a press can still spend: every other
 * state is a panel that names nobody, and a dead link handed onward identifies nobody either.
 */
export type BestaetigungStart = { zustand: "gueltig"; ansicht: EinwilligungGeoeffnet; token: string } | { zustand: LinkZustand | "unlesbar" };

type Stand =
  | BestaetigungStart
  | { zustand: "erfolg"; ansicht: EinwilligungGeoeffnet; geburtsdatum: string | null; whatsapp: boolean }
  | { zustand: "widersprochen-neu"; ansicht: EinwilligungGeoeffnet };

/** One heading per state, uppercased by the page rather than typed so, as the application page does it. */
const TITEL: Record<Stand["zustand"], string> = {
  gueltig: "Eintrag bestätigen",
  erfolg: "Eintrag bestätigt",
  "widersprochen-neu": "Widerspruch gespeichert",
  bestaetigt: "Schon erledigt",
  abgelehnt: "Schon erledigt",
  abgelaufen: "Link ungültig",
  ungueltig: "Link ungültig",
  unlesbar: "Link nicht geprüft",
};

/** The application page's own column, so the two ends of the workflow are one page wide. */
const SEITE = "max-w-meta flex w-full flex-col gap-5 px-3 pt-4 pb-10 sm:px-6 lg:px-8 lg:pt-8";

const ABSATZ = "fluid-sm text-foreground max-w-2xl leading-relaxed font-medium text-pretty";

const rollenLangform = (rolle: KontaktRolle): string => KONTAKT_ROLLEN.find((eintrag) => eintrag.value === rolle)?.langform ?? "";

/** The press's answer folded into the page's state, carrying the read that the panel still names the person from. */
function nachAntwort(abschluss: BestaetigungAbschluss, ansicht: EinwilligungGeoeffnet): Stand {
  if (abschluss.zustand === "erfolg") return { ...abschluss, ansicht: ansicht };
  if (abschluss.zustand === "widersprochen-neu") return { zustand: "widersprochen-neu", ansicht: ansicht };

  return abschluss;
}

/** Which states know a season, and so may wear the chip the public pages head a season's page with. */
function saisonVon(stand: Stand): string | null {
  return stand.zustand === "gueltig" || stand.zustand === "erfolg" || stand.zustand === "widersprochen-neu" ? stand.ansicht.saison_id : null;
}

/**
 * One page for every state a link can be in, framed by the site's own navbar and footer: a contact
 * opening the link on a phone lands on the site the email named.
 */
export function BestaetigungView({ start }: { start: BestaetigungStart }) {
  const [stand, setStand] = useState<Stand>(start);
  const [hatGeantwortet, setHatGeantwortet] = useState(false);
  const ergebnisRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // The bare path after hydration, so the address bar, a screenshot and a bookmark carry no
    // token. Not while the read failed: a reload is the way back, and it needs the token in the URL.
    if (stand.zustand === "unlesbar" || window.location.search === "") return;
    window.history.replaceState(null, "", window.location.pathname);
  }, [stand.zustand]);

  // The form unmounts from under the pressed button, so focus would fall to `<body>` with nothing
  // announced; the panel takes it, and `role="status"` reads it out.
  useEffect(() => {
    if (hatGeantwortet) ergebnisRef.current?.focus();
  }, [hatGeantwortet]);

  const saison = saisonVon(stand);

  return (
    <section className={SEITE}>
      <header className="flex w-full flex-col gap-3">
        {saison !== null && <SaisonChip>Saison {saison}</SaisonChip>}
        <h1 className="fluid-3xl text-foreground font-black tracking-tight uppercase">{TITEL[stand.zustand]}</h1>

        {stand.zustand === "gueltig" && (
          <>
            <p className={ABSATZ}>
              Hallo <Wert>{stand.ansicht.vorname}</Wert>, Du bist in der Bewerbung der Schule <Wert>{stand.ansicht.schule}</Wert> zur Saison{" "}
              <Wert>{stand.ansicht.saison_id}</Wert> als <Wert>{rollenLangform(stand.ansicht.rolle)}</Wert> eingetragen. Bitte bestätige, dass
              das stimmt und dass diese E-Mail-Adresse Deine ist.
            </p>
            <Fakten
              zeilen={[
                { label: "Schule", wert: stand.ansicht.schule },
                { label: "Saison", wert: stand.ansicht.saison_id },
                { label: "Deine Rolle", wert: rollenLangform(stand.ansicht.rolle) },
              ]}
            />
          </>
        )}
      </header>

      {stand.zustand === "gueltig" && (
        <BestaetigungFormPanel
          token={stand.token}
          vorname={stand.ansicht.vorname}
          schule={stand.ansicht.schule}
          saison={stand.ansicht.saison_id}
          rolle={rollenLangform(stand.ansicht.rolle)}
          onAbschluss={(abschluss) => {
            setHatGeantwortet(true);
            setStand(nachAntwort(abschluss, stand.ansicht));
          }}
        />
      )}

      {stand.zustand === "erfolg" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="erfolg">
          <p className={ABSATZ}>
            Danke, <Wert>{stand.ansicht.vorname}</Wert>. Dein Eintrag für die Schule <Wert>{stand.ansicht.schule}</Wert> ist bestätigt.
          </p>
          {/* Echoed so the person sees what was recorded, in the press's own answer and nowhere fetchable. */}
          <Fakten
            zeilen={[
              { label: "Rolle", wert: rollenLangform(stand.ansicht.rolle) },
              { label: "Geburtsdatum", wert: formatSpielDatum(stand.geburtsdatum) },
              { label: "WhatsApp", wert: stand.whatsapp ? "erlaubt" : "nicht erlaubt" },
            ]}
          />
          <p className={ABSATZ}>
            Sobald alle Kontaktpersonen bestätigt haben, ist die Bewerbung vollständig, und die Person, die sie eingereicht hat, bekommt eine
            E-Mail. Du musst nichts weiter tun.
          </p>
          <p className={ABSATZ}>Fragen, Löschung und Widerspruch jederzeit per E-Mail an {KONTAKT_EMAIL}.</p>
          <ZurLiga />
        </BestaetigungErgebnis>
      )}

      {stand.zustand === "widersprochen-neu" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="erfolg">
          <p className={ABSATZ}>
            Danke für Deine Antwort, <Wert>{stand.ansicht.vorname}</Wert>. Deine Angaben haben wir aus der Bewerbung entfernt und der Person
            Bescheid gesagt, die sie eingereicht hat.
          </p>
          <p className={ABSATZ}>
            Falls Du es Dir anders überlegst, kann Deine Schule Dich in einer neuen Bewerbung wieder eintragen. Du bekommst dann eine neue
            E-Mail.
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
          <p className={ABSATZ}>Dieser Eintrag ist schon bestätigt. Du musst nichts weiter tun.</p>
          <p className={ABSATZ}>Fragen, Löschung und Widerspruch jederzeit per E-Mail an {KONTAKT_EMAIL}.</p>
          <ZurLiga />
        </BestaetigungErgebnis>
      )}

      {stand.zustand === "abgelehnt" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="erfolg">
          <p className={ABSATZ}>
            Über diesen Link wurde dem Eintrag schon widersprochen. Die Angaben sind aus der Bewerbung entfernt, und Du musst nichts weiter tun.
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
          <p className={ABSATZ}>
            Dieser Link ist ungültig oder abgelaufen. Ein Link gilt {String(BEWERBUNG_BESTAETIGUNG_FRIST_TAGE)} Tage. Eine Bewerbung, die bis
            dahin nicht alle Bestätigungen hat, löschen wir mit allen Angaben.
          </p>
          <p className={ABSATZ}>Wird Deine Schule neu eingetragen, bekommst Du eine neue E-Mail mit einem neuen Link.</p>
          <FrageStellen />
        </BestaetigungErgebnis>
      )}

      {/* Says that it does not know, and nothing else: folded into the dead-link panel, this arm
          would call a live link void on a day the backend was merely unreachable. */}
      {stand.zustand === "unlesbar" && (
        <BestaetigungErgebnis
          panelRef={ergebnisRef}
          tone="hinweis">
          <p className={ABSATZ}>Wir können diesen Link gerade nicht prüfen. Lade die Seite in ein paar Minuten neu, oder schreib uns.</p>
          <FrageStellen />
        </BestaetigungErgebnis>
      )}

      <SeitenFuss zustand={stand.zustand} />
    </section>
  );
}

/** The two actions this page offers, in the width the panel gives them rather than the page's. */
function Aktion({ children }: { children: ReactNode }) {
  return <div className="mt-2 flex w-full max-w-xs flex-col">{children}</div>;
}

function ZurLiga() {
  return (
    <Aktion>
      <Link
        href="/"
        prefetch={false}
        className={ctaButton({ intent: "outline", hover: "css" })}>
        Zur Frankfurt League
      </Link>
    </Aktion>
  );
}

function FrageStellen() {
  return (
    <Aktion>
      <a
        href={`mailto:${KONTAKT_EMAIL}`}
        className={ctaButton({ intent: "primary", hover: "css" })}>
        Frage stellen
      </a>
    </Aktion>
  );
}

/**
 * The legal links and the controller in every state: the site's own footer under this one carries
 * the links again, and a page reached from an email has to stand on its own.
 */
function SeitenFuss({ zustand }: { zustand: Stand["zustand"] }) {
  const linkKlasse = textLink({ tone: "muted" });

  return (
    <footer className="border-border muted-meta flex flex-col items-center gap-y-1 border-t pt-5 text-center">
      {zustand === "gueltig" && (
        <p>
          Fragen, Löschung und Widerspruch:{" "}
          <a
            href={`mailto:${KONTAKT_EMAIL}`}
            className={linkKlasse}>
            {KONTAKT_EMAIL}
          </a>
        </p>
      )}
      {zustand === "erfolg" && <p>Diesen Link kannst Du jetzt vergessen: er funktioniert nur einmal.</p>}
      {(zustand === "abgelaufen" || zustand === "ungueltig" || zustand === "unlesbar") && (
        <p>
          <a
            href={`mailto:${KONTAKT_EMAIL}`}
            className={linkKlasse}>
            {KONTAKT_EMAIL}
          </a>
        </p>
      )}
      <p>
        <Link
          href="/datenschutz"
          prefetch={false}
          className={linkKlasse}>
          Datenschutzerklärung
        </Link>
        {" · "}
        <Link
          href="/impressum"
          prefetch={false}
          className={linkKlasse}>
          Impressum
        </Link>
      </p>
      <p>
        Verantwortlich: {VEREIN_NAME}, {VEREIN_ANSCHRIFT}
      </p>
    </footer>
  );
}
