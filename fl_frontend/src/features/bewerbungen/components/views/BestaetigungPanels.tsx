import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import CircleCheck from "@gravity-ui/icons/CircleCheck";
import TriangleExclamation from "@gravity-ui/icons/TriangleExclamation";
import { tv } from "tailwind-variants";

import { KONTAKT_EMAIL } from "@/core/brand";
import { ABSATZ_CLASSES, Wert } from "@/features/bewerbungen/components/ui/Gefuellt";
import { SEITE_CLASSES } from "@/features/bewerbungen/components/ui/seite";
import { ctaButton } from "@/shared/components/ui/formButtons";
import { formPanel } from "@/shared/components/ui/formPanel";
import { NAME_WRAP_CLASSES } from "@/shared/components/ui/nameWrap";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { VERSUCHE_ES_ERNEUT_SATZ } from "@/shared/utils/refusal";
import { LINK_ADRESSE_GESPERRT } from "@/shared/utils/reopenLink";

import type { ReactNode, RefObject } from "react";

/** The heading of a page whose link could not be checked, on every page a token link opens. */
export const LINK_UNLESBAR_TITEL = "Link nicht geprüft";

/** The failure's title on every page a token link opens: „Änderung nicht gespeichert“ names a change nobody here made. */
export const ANTWORT_NICHT_GESPEICHERT = "Antwort nicht gespeichert";

/** What a press that wrote nothing and named no reason tells its person, on every page a token link opens. */
export const ANTWORT_NICHT_GESPEICHERT_SATZ = `Deine Antwort wurde nicht gespeichert. ${VERSUCHE_ES_ERNEUT_SATZ}`;

/** Shared by every page a token link opens, so none of them alone keeps its token in the address or drops the answer's focus. */
export function useLinkSeite(zustand: string): { ergebnisRef: RefObject<HTMLElement | null>; beantwortet: () => void } {
  const [hatGeantwortet, setHatGeantwortet] = useState(false);
  const ergebnisRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // The bare path after hydration, so the address bar, a screenshot and a bookmark carry no token.
    // Not while the read failed: a reload is the way back, and it needs the token in the URL.
    if (zustand === "unlesbar" || window.location.search === "") return;
    window.history.replaceState(null, "", window.location.pathname);
  }, [zustand]);

  // The form unmounts from under the pressed button, so focus would fall to `<body>` with nothing
  // announced; the panel takes it, and `role="status"` reads it out.
  useEffect(() => {
    if (hatGeantwortet) ergebnisRef.current?.focus();
  }, [hatGeantwortet]);

  return { ergebnisRef: ergebnisRef, beantwortet: () => setHatGeantwortet(true) };
}

/**
 * One section of the page, in the shell every panel of the application form wears
 * (`fl_frontend/src/features/bewerbungen/components/forms/BewerbungForm/BewerbungForm.tsx`): a
 * contact meets the same box on both ends of the workflow.
 */
export function BestaetigungAbschnitt({ titel, children }: { titel: string; children: ReactNode }) {
  const panel = formPanel();

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title={titel}
        />
      </div>
      <div className={panel.body()}>{children}</div>
    </section>
  );
}

/**
 * The label-over-value pair the admin application page sets its stored facts in
 * (`fl_frontend/src/shared/components/ui/Angabe.tsx :: Angabe`),
 * spelled once so the banner and the receipt cannot drift into two type scales.
 */
const ANGABE_LABEL_CLASSES = "fluid-xxs font-bold text-foreground-muted";
const ANGABE_WERT_CLASSES = "fluid-sm";

type Fakt = {
  label: string;
  wert: string;
  /** The one value nothing bounds — a school's name — which takes the width the others leave. */
  unbegrenzt?: boolean;
};

const fakt = tv({
  slots: {
    // `min-w-0` on every cell, or one long word would push the row past the panel's edge.
    zelle: "flex min-w-0 flex-col gap-y-0.5",
    wert: ANGABE_WERT_CLASSES,
  },
  variants: {
    unbegrenzt: {
      // A line of its own on a phone; from `sm` it grows into the width the other facts leave.
      true: { zelle: "basis-full sm:flex-1", wert: NAME_WRAP_CLASSES },
      false: { zelle: "flex-initial" },
    },
  },
});

/**
 * The mails' own fact panel in the page's tokens
 * (`fl_frontend/src/core/bewerbungEmail.ts :: renderFakten`). **Every value is read whole**: no
 * ellipsis, since a phone has no pointer to hover a `title` with.
 */
export function FaktenBanner({ zeilen }: { zeilen: readonly Fakt[] }) {
  // The mail's 8px rather than a panel's arc, which the page's box count reads as `rounded-2xl`.
  // Wrapping below `sm` alone: from there every fact fits one row, and a stack would spend the first
  // screen on them.
  return (
    <dl className="flex w-full flex-row flex-wrap items-start gap-x-4 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3 text-left sm:flex-nowrap sm:gap-x-6">
      {zeilen.map(({ label, wert, unbegrenzt = false }) => {
        const { zelle, wert: wertKlasse } = fakt({ unbegrenzt: unbegrenzt });

        return (
          <div
            key={label}
            className={zelle()}>
            <dt className={ANGABE_LABEL_CLASSES}>{label}</dt>
            <dd className={wertKlasse()}>
              <Wert>{wert}</Wert>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * The media consent's row on every confirmation page's receipt, in the words each page asks it in, so the
 * three pages cannot read the one consent three ways.
 */
export const medienZeile = (medien: boolean): { label: string; wert: string } => ({
  label: "Fotos, Videos und Interviews",
  wert: medien ? "erlaubt" : "nicht erlaubt",
});

/**
 * **Sized to its content and never to the width**: two cells spread across a panel put the second
 * alone at the far edge, which reads as a column that lost its table rather than as a pair.
 */
export function GespeicherteAngaben({ zeilen }: { zeilen: readonly { label: string; wert: string }[] }) {
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-3 text-left">
      {zeilen.map(({ label, wert }) => (
        <div
          key={label}
          className="flex flex-col gap-y-0.5">
          <dt className={ANGABE_LABEL_CLASSES}>{label}</dt>
          <dd className={ANGABE_WERT_CLASSES}>
            <Wert>{wert}</Wert>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The receipt panel at both ends of the application — this page's states and the form's own
 * „eingegangen“ box
 * (`fl_frontend/src/features/bewerbungen/components/forms/BewerbungForm/BewerbungForm.tsx`) — one
 * formula for both tones, a second spelling being one nobody re-measures against the scheme.
 */
export const ergebnisPanel = tv({
  base: "flex w-full flex-col items-center gap-y-4 rounded-2xl border p-6 text-center shadow-sm outline-none sm:p-8",
  variants: {
    tone: {
      erfolg: "border-success/40 bg-success/10",
      hinweis: "border-warning/40 bg-warning/10",
    },
  },
});

const GLYPHE = { erfolg: CircleCheck, hinweis: TriangleExclamation } as const;
const GLYPHE_FARBE_CLASSES = { erfolg: "size-10 text-success-strong", hinweis: "size-10 text-warning-strong" } as const;

/**
 * Every state but the form is this panel: one box, one glyph, one tone, so a done thing and a dead
 * link are told apart by a grade a reader sees rather than by reading the paragraph.
 */
export function BestaetigungErgebnis({
  panelRef,
  tone,
  children,
}: {
  /** Set where the panel replaced the form under the pressed button, so the caret has somewhere to land. */
  panelRef?: RefObject<HTMLElement | null>;
  tone: "erfolg" | "hinweis";
  children: ReactNode;
}) {
  const Icon = GLYPHE[tone];

  return (
    <section
      ref={panelRef}
      role="status"
      tabIndex={-1}
      className={ergebnisPanel({ tone })}>
      <Icon
        aria-hidden="true"
        className={GLYPHE_FARBE_CLASSES[tone]}
      />
      {children}
    </section>
  );
}

/**
 * **The whole page a barred link opens on, on every confirmation page**: the sentence and
 * nothing else (`docs/frontend/spec.md :: I516`). A Widerspruch or any other request goes by mail to
 * the address it names.
 */
export function AdresseGesperrt({ panelRef }: { panelRef: RefObject<HTMLElement | null> }) {
  return (
    <section className={SEITE_CLASSES}>
      <BestaetigungErgebnis
        panelRef={panelRef}
        tone="hinweis">
        <p className={ABSATZ_CLASSES}>{LINK_ADRESSE_GESPERRT}</p>
      </BestaetigungErgebnis>
    </section>
  );
}

/**
 * **The whole of what a page whose link could not be checked says**: that it does not know. Folded into
 * the dead-link panel, it would call a live link void on a day the backend was merely unreachable.
 */
export function LinkUnlesbar({ panelRef }: { panelRef?: RefObject<HTMLElement | null> }) {
  return (
    <BestaetigungErgebnis
      panelRef={panelRef}
      tone="hinweis">
      <p className={ABSATZ_CLASSES}>Wir können diesen Link gerade nicht prüfen. Lade die Seite in ein paar Minuten neu, oder schreib uns.</p>
      <FrageStellen />
    </BestaetigungErgebnis>
  );
}

/** The action a result panel offers, in the width the panel gives it rather than the page's. */
function Aktion({ children }: { children: ReactNode }) {
  return <div className="flex w-full max-w-xs flex-col">{children}</div>;
}

/** The way back for a reader whose business here is done. */
export function ZurLiga() {
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

/** The way out for a reader a panel could not help: a mailbox, never a form they have no link for. */
export function FrageStellen() {
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
