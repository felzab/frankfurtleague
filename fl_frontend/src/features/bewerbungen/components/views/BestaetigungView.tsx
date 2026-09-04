"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { CircleCheck, TriangleExclamation } from "@gravity-ui/icons";

import { KONTAKT_EMAIL, VEREIN_ANSCHRIFT, VEREIN_NAME } from "@/core/brand";
import { BEWERBUNG_BESTAETIGUNG_FRIST_TAGE } from "@/features/bewerbungen/constants";
import { KONTAKT_ROLLEN } from "@/features/teams/constants";
import { FLLogo } from "@/shared/components/ui/FLLogo";
import { ctaButton } from "@/shared/components/ui/formButtons";
import { formPanel } from "@/shared/components/ui/formPanel";
import { textLink } from "@/shared/components/ui/textLink";
import { formatSpielDatum } from "@/shared/utils/format";

import { BestaetigungFormPanel } from "./BestaetigungFormPanel";

import type { EinwilligungGeoeffnet, LinkZustand } from "@/features/bewerbungen/types";
import type { KontaktRolle } from "@/features/teams/constants";
import type { ReactNode, RefObject } from "react";
import type { BestaetigungAbschluss } from "./BestaetigungFormPanel";

/**
 * What the page opens on. The token rides only with a link a press can still spend: every other
 * state is a panel that names nobody, and a dead link handed onward identifies nobody either.
 */
export type BestaetigungStart = { zustand: "gueltig"; ansicht: EinwilligungGeoeffnet; token: string } | { zustand: LinkZustand | "unlesbar" };

type Stand =
  | BestaetigungStart
  | { zustand: "erfolg"; ansicht: EinwilligungGeoeffnet; geburtsdatum: string | null; whatsapp: boolean }
  | { zustand: "abgelehnt-neu"; ansicht: EinwilligungGeoeffnet };

/** One heading per state, uppercased by the card rather than typed so, as the sign-in card does it. */
const TITEL: Record<Stand["zustand"], string> = {
  gueltig: "Eintrag bestätigen",
  erfolg: "Eintrag bestätigt",
  "abgelehnt-neu": "Eintrag abgelehnt",
  bestaetigt: "Schon erledigt",
  abgelehnt: "Schon erledigt",
  abgelaufen: "Link ungültig",
  ungueltig: "Link ungültig",
  unlesbar: "Link nicht geprüft",
};

const ABSATZ = "muted-hint max-w-md text-pretty";

const rollenLangform = (rolle: KontaktRolle): string => KONTAKT_ROLLEN.find((eintrag) => eintrag.value === rolle)?.langform ?? "";

/** The press's answer folded into the page's state, carrying the read that the panel still names the person from. */
function nachAntwort(abschluss: BestaetigungAbschluss, ansicht: EinwilligungGeoeffnet): Stand {
  if (abschluss.zustand === "erfolg") return { ...abschluss, ansicht: ansicht };
  if (abschluss.zustand === "abgelehnt-neu") return { zustand: "abgelehnt-neu", ansicht: ansicht };

  return abschluss;
}

/**
 * One card for every state a link can be in, framed by the site's own navbar and footer: a contact
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

  return (
    <div className="flex w-full justify-center px-4 py-8 sm:py-12">
      {/* The form's own panel shell rather than the sign-in's blurred card: this page has no backdrop. */}
      <div className={`${formPanel().root()} max-w-[460px] gap-y-6 p-6 sm:p-10`}>
        <header className="border-border flex flex-col items-center gap-y-3 border-b pb-5 text-center">
          <FLLogo className="size-10" />
          <h1 className="fluid-2xl text-foreground font-black tracking-tight uppercase">{TITEL[stand.zustand]}</h1>
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
          <ErgebnisPanel
            panelRef={ergebnisRef}
            tone="erfolg">
            <p className={ABSATZ}>
              <strong className="text-foreground font-bold">Danke, {stand.ansicht.vorname}.</strong> Dein Eintrag ist bestätigt:{" "}
              {stand.ansicht.schule}, Saison {stand.ansicht.saison_id}.
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
              E-Mail. <strong className="text-foreground font-bold">Du musst nichts weiter tun.</strong>
            </p>
            <p className={ABSATZ}>Fragen, Löschung und Widerspruch jederzeit per E-Mail an {KONTAKT_EMAIL}.</p>
            <ZurLiga />
          </ErgebnisPanel>
        )}

        {stand.zustand === "abgelehnt-neu" && (
          <ErgebnisPanel
            panelRef={ergebnisRef}
            tone="hinweis">
            <p className={ABSATZ}>
              Danke für Deine Antwort, {stand.ansicht.vorname}. Deine Angaben haben wir aus der Bewerbung entfernt und der Person Bescheid
              gesagt, die sie eingereicht hat.
            </p>
            <p className={ABSATZ}>
              Falls Du es Dir anders überlegst, kann Deine Schule Dich in einer neuen Bewerbung wieder eintragen. Du bekommst dann eine neue
              E-Mail.
            </p>
            <ZurLiga />
          </ErgebnisPanel>
        )}

        {/* No name and no school from here on: a consumed or dead link may have been forwarded, and a
            dead link identifies nobody. */}
        {stand.zustand === "bestaetigt" && (
          <ErgebnisPanel
            panelRef={ergebnisRef}
            tone="hinweis">
            <p className={ABSATZ}>Dieser Eintrag ist schon bestätigt. Du musst nichts weiter tun.</p>
            <p className={ABSATZ}>Fragen, Löschung und Widerspruch jederzeit per E-Mail an {KONTAKT_EMAIL}.</p>
            <ZurLiga />
          </ErgebnisPanel>
        )}

        {stand.zustand === "abgelehnt" && (
          <ErgebnisPanel
            panelRef={ergebnisRef}
            tone="hinweis">
            <p className={ABSATZ}>
              Über diesen Link wurde der Eintrag schon abgelehnt. Die Angaben sind aus der Bewerbung entfernt, und Du musst nichts weiter tun.
            </p>
            <ZurLiga />
          </ErgebnisPanel>
        )}

        {/* One wording for both: after the deletion the record is gone and the two cannot be told
            apart, and telling them apart would tell a guessed link that a record once existed. */}
        {(stand.zustand === "abgelaufen" || stand.zustand === "ungueltig") && (
          <ErgebnisPanel
            panelRef={ergebnisRef}
            tone="hinweis">
            <p className={ABSATZ}>
              <strong className="text-foreground font-bold">Dieser Link ist ungültig oder abgelaufen.</strong> Ein Link gilt{" "}
              {String(BEWERBUNG_BESTAETIGUNG_FRIST_TAGE)} Tage. Eine Bewerbung, die bis dahin nicht alle Bestätigungen hat, löschen wir mit
              allen Angaben.
            </p>
            <p className={ABSATZ}>
              Wird Deine Schule neu eingetragen, bekommst Du eine neue E-Mail mit einem neuen Link. Bei Fragen schreib uns.
            </p>
            <FrageStellen />
          </ErgebnisPanel>
        )}

        {/* Says that it does not know, and nothing else: folded into the dead-link panel, this arm
            would call a live link void on a day the backend was merely unreachable. */}
        {stand.zustand === "unlesbar" && (
          <ErgebnisPanel
            panelRef={ergebnisRef}
            tone="hinweis">
            <p className={ABSATZ}>Wir können diesen Link gerade nicht prüfen. Lade die Seite in ein paar Minuten neu, oder schreib uns.</p>
            <FrageStellen />
          </ErgebnisPanel>
        )}

        <KartenFuss zustand={stand.zustand} />
      </div>
    </div>
  );
}

/** The success shape the application form already uses, so a contact meets one design for „erledigt“ across the site. */
function ErgebnisPanel({
  panelRef,
  tone,
  children,
}: {
  panelRef: RefObject<HTMLElement | null>;
  tone: "erfolg" | "hinweis";
  children: ReactNode;
}) {
  const Icon = tone === "erfolg" ? CircleCheck : TriangleExclamation;

  return (
    <section
      ref={panelRef}
      role="status"
      tabIndex={-1}
      className="flex w-full flex-col items-center gap-y-3 text-center outline-none">
      <Icon
        aria-hidden="true"
        className={tone === "erfolg" ? "text-success-strong size-10" : "text-warning-strong size-10"}
      />
      {children}
    </section>
  );
}

function Fakten({ zeilen }: { zeilen: readonly { label: string; wert: string }[] }) {
  return (
    <dl className="bg-background border-border fluid-sm grid w-full grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-xl border px-4 py-3 text-left">
      {zeilen.map(({ label, wert }) => (
        <Fragment key={label}>
          <dt className="text-foreground-muted font-medium">{label}</dt>
          <dd className="text-foreground font-bold">{wert}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function ZurLiga() {
  return (
    <Link
      href="/"
      prefetch={false}
      className={`${ctaButton({ intent: "outline", hover: "css" })} mt-2 w-full`}>
      Zur Frankfurt League
    </Link>
  );
}

function FrageStellen() {
  return (
    <a
      href={`mailto:${KONTAKT_EMAIL}`}
      className={`${ctaButton({ intent: "primary", hover: "css" })} mt-2 w-full`}>
      Frage stellen
    </a>
  );
}

/**
 * The legal links and the controller in every state, inside the card: the site's own footer under it
 * carries the links again, and a card reached from an email has to stand on its own.
 */
function KartenFuss({ zustand }: { zustand: Stand["zustand"] }) {
  const linkKlasse = textLink({ tone: "muted" });

  return (
    <footer className="border-border muted-meta flex flex-col items-center gap-y-1 border-t pt-4 text-center">
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
