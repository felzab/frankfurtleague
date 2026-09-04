import Link from "next/link";

import { At, CircleInfo, Eye } from "@gravity-ui/icons";

import { BewerbungForm } from "@/features/bewerbungen/components/forms/BewerbungForm/BewerbungForm";
import { abiJahrgang, fensterZustand } from "@/features/bewerbungen/utils";
import { SaisonChip } from "@/features/saisons/components/ui/SaisonChip";
import { ctaButton } from "@/shared/components/ui/formButtons";
import { formPanel } from "@/shared/components/ui/formPanel";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLBewerbungFensterResponse } from "@/features/bewerbungen/schemas";
import type { FLTrikotFarbe } from "@/features/teams/schemas";

/** Where a school goes when this page cannot take its application, whatever closed it. */
const ZUM_KONTAKT = { href: "/kontakt", label: "Zum Kontakt" };

/**
 * The rest of the site, from a page reached cold. `/dashboard` carries no `?saison_id=` and redirects
 * to the RUNNING season, never the future one this page is about — which is why its label names that
 * season, not the nav's „Saisonübersicht“.
 */
const KOPF_LINKS = [
  { href: "/about", label: "About", anlass: "Mehr erfahren", Icon: CircleInfo },
  { href: "/kontakt", label: "Kontakt", anlass: "Bei Fragen", Icon: At },
  { href: "/dashboard", label: "Laufende Saison", anlass: "Zum Mitfiebern", Icon: Eye },
] as const;

/**
 * The page one school sees of the league before it sees anything else.
 *
 * **A closed window renders this page rather than a 404**: a school arriving on last year's link
 * has a question, and 404 answers none of it.
 */
export function BewerbungView({
  saisonId,
  fenster,
  isUnlesbar,
  today,
  schulen,
  isSchulenLesbar,
  vergebeneFarben,
}: {
  saisonId: string;
  /** `null` where the season takes no applications at all, which is its own answer. */
  fenster: FLBewerbungFensterResponse | null;
  /** The window could not be read. Never folded into a closed state: no deadline was learnt. */
  isUnlesbar: boolean;
  /** Resolved by the page, which is where the request scope that makes a clock legal is opened. */
  today: string;
  /** Empty unless the window runs: a closed page reads no club list for a picker it never shows. */
  schulen: readonly { id: string; name: string }[];
  isSchulenLesbar: boolean;
  vergebeneFarben: readonly FLTrikotFarbe[];
}) {
  const zustand = isUnlesbar ? "unlesbar" : fensterZustand(fenster, today);

  return (
    <section className="max-w-meta flex w-full flex-col gap-5 px-3 pt-4 pb-10 sm:px-6 lg:px-8 lg:pt-8">
      <header className="border-border bg-surface relative flex flex-col gap-4 overflow-hidden rounded-3xl border px-4 py-6 shadow-sm sm:p-8">
        <div className="bg-brand-solid absolute top-0 left-0 h-1.5 w-full" />

        <SaisonChip>Saison {saisonId}</SaisonChip>

        <h1 className="fluid-3xl font-black tracking-tight uppercase">
          Mit Deiner Schule <span className="text-brand">mitspielen</span>
        </h1>

        {/* The invitation is the RUNNING state's alone: every other state renders no form, and „Trag
            Dein Team hier ein“ above a panel saying the window is shut is the page contradicting itself. */}
        <p className="muted-hint max-w-xl">
          Die Frankfurt-League ist das Fußballturnier der Frankfurter Oberstufen.{" "}
          {zustand === "laeuft"
            ? "Trag Dein Team hier ein. Nach dem Abschicken bekommt jede Kontaktperson eine E-Mail mit einem Link, über den sie ihren Eintrag bestätigt."
            : "Auf dieser Seite melden Schulen ihr Team für eine Saison an."}
        </p>

        {zustand === "laeuft" && fenster !== null && (
          <FensterFakten
            saisonId={saisonId}
            bis={fenster.bis}
          />
        )}

        <nav className="border-border mt-1 grid grid-cols-1 gap-x-3 gap-y-4 border-t pt-6 sm:grid-cols-3">
          {KOPF_LINKS.map(({ href, label, anlass, Icon }) => (
            <div
              key={href}
              className="flex flex-col gap-1.5">
              {/* The site's eyebrow, so the reason to press reads like every other label on the page. */}
              <span className="fluid-xxs text-brand font-extrabold tracking-widest uppercase">{anlass}</span>

              <Link
                href={href}
                prefetch={false}
                className={`${ctaButton({ intent: "outline", size: "sm", hover: "css" })} gap-2`}>
                {/* Each link's own icon, from `TopNav`'s dictionary: the three are peers rather than a
                    ranked set, so nothing but the glyph separates them. */}
                <Icon
                  className="size-4 shrink-0"
                  aria-hidden="true"
                />
                {label}
              </Link>
            </div>
          ))}
        </nav>
      </header>

      {zustand === "laeuft" && fenster !== null && (
        <BewerbungForm
          saisonId={saisonId}
          schulen={schulen}
          isSchulenLesbar={isSchulenLesbar}
          vergebeneFarben={vergebeneFarben}
        />
      )}

      {zustand === "noch-nicht" && fenster !== null && (
        <ZustandPanel
          titel="Die Bewerbung ist noch nicht offen"
          text={`Für die Saison ${saisonId} kannst Du Dich ab dem ${formatSpielDatum(fenster.von)} bewerben. Schau dann wieder vorbei.`}
        />
      )}

      {/* Its own answer, and never „abgelaufen“: nothing ran out, the league closed it. */}
      {zustand === "geschlossen" && (
        <ZustandPanel
          titel="Die Bewerbung ist gerade geschlossen"
          text={`Für die Saison ${saisonId} nehmen wir im Moment keine Bewerbungen an. Schreib uns, dann sagen wir Dir, wann es wieder losgeht.`}
          aktion={ZUM_KONTAKT}
        />
      )}

      {zustand === "keine-frist" && (
        <ZustandPanel
          titel="Für diese Saison gibt es keine Bewerbung"
          text={`Zur Saison ${saisonId} ist bei uns keine Bewerbungsfrist hinterlegt. Schreib uns, dann sagen wir Dir, für welche Saison Du Dich bewerben kannst.`}
          aktion={ZUM_KONTAKT}
        />
      )}

      {zustand === "vorbei" && (
        <ZustandPanel
          titel="Die Bewerbungsfrist ist abgelaufen"
          text={`Für die Saison ${saisonId} nehmen wir keine Bewerbungen mehr an. Schreib uns trotzdem: wir sagen Dir, was noch geht und wann die nächste Saison öffnet.`}
          aktion={ZUM_KONTAKT}
        />
      )}

      {/* Says that it does not know, and nothing else. Folded into a closed state, this arm would
          tell a school the deadline had passed on a day the league was still taking applications. */}
      {zustand === "unlesbar" && (
        <ZustandPanel
          titel="Wir können die Bewerbungsfrist gerade nicht abrufen"
          text="Ob für diese Saison Bewerbungen laufen, können wir Dir im Moment nicht sagen. Lade die Seite in ein paar Minuten neu, oder schreib uns."
          aktion={ZUM_KONTAKT}
        />
      )}
    </section>
  );
}

/**
 * The two facts that decide whether a school may apply at all, in the header and not a strip beside
 * it: a reader who misses them fills in a form that cannot be accepted. The brand fill, not a tint —
 * this is the page's entry condition, not a note.
 */
function FensterFakten({ saisonId, bis }: { saisonId: string; bis: string }) {
  return (
    <dl className="bg-brand-solid text-brand-solid-foreground flex w-full flex-col gap-4 rounded-2xl p-4 shadow-md sm:flex-row sm:items-center sm:gap-8 sm:p-5">
      <Fakt label="Wer mitspielen darf">Abi-Jahrgang {abiJahrgang(saisonId)}</Fakt>

      <div
        className="bg-brand-solid-foreground/25 h-px w-full shrink-0 sm:h-10 sm:w-px"
        aria-hidden="true"
      />

      <Fakt label="Bewerbungsschluss">{formatSpielDatum(bis)}</Fakt>
    </dl>
  );
}

/** One entry condition. A `<dl>` is its only valid parent: the pair is what makes the value a fact about the label. */
function Fakt({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-y-0.5">
      {/* The site's eyebrow in the fill's paired foreground at 75%, which composites to 6.2:1 on it —
          `text-brand` is the TINT of this fill and would read as a smudge on it. */}
      <dt className="fluid-xxs text-brand-solid-foreground/75 font-extrabold tracking-widest uppercase">{label}</dt>
      <dd className="fluid-lg font-black">{children}</dd>
    </div>
  );
}

/**
 * A closed window's whole answer. A panel and not a `Callout`: this IS the page's content rather than
 * a note beside it, and a page whose only body is a warning strip reads as one that failed to load.
 */
function ZustandPanel({ titel, text, aktion }: { titel: string; text: string; aktion?: { href: string; label: string } }) {
  return (
    /* The form's own panel, not a fourth spelling of it: this box says the same thing the sections around it
       say, and only its padding and its centring are its own. */
    <div className={`${formPanel().root()} items-start gap-y-4 p-6 sm:p-8`}>
      <h2 className="fluid-lg text-foreground font-extrabold tracking-tight">{titel}</h2>
      <p className="muted-hint max-w-xl">{text}</p>

      {aktion !== undefined && (
        <Link
          href={aktion.href}
          prefetch={false}
          className={`${ctaButton({ intent: "primary", size: "sm", hover: "css" })} w-full sm:w-56`}>
          {aktion.label}
        </Link>
      )}
    </div>
  );
}
