import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import CircleCheck from "@gravity-ui/icons/CircleCheck";
import TriangleExclamation from "@gravity-ui/icons/TriangleExclamation";
import { tv } from "tailwind-variants";

import { KONTAKT_EMAIL } from "@/core/brand";
import { PARAGRAPH_CLASSES, Value } from "@/features/bewerbungen/components/ui/Filled";
import { ctaButton } from "@/shared/components/ui/formButtons";
import { formPanel } from "@/shared/components/ui/formPanel";
import { NAME_WRAP_CLASSES } from "@/shared/components/ui/nameWrap";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { VERSUCHE_ES_ERNEUT_SATZ } from "@/shared/utils/refusal";

import type { ReactNode, RefObject } from "react";

// Redesign: this file goes with the old link pages in `features/address-change`, `features/registrierungen` and `features/spielbestaetigungen`.
/** The heading of a page whose link could not be checked, on every page a token link opens. */
export const LINK_UNREADABLE_TITLE = "Link nicht geprüft";

/** The failure's title on every page a token link opens: „Änderung nicht gespeichert“ names a change nobody here made. */
export const ANSWER_NOT_SAVED = "Antwort nicht gespeichert";

/** What a press that wrote nothing and named no reason tells its person, on every page a token link opens. */
export const ANSWER_NOT_SAVED_SENTENCE = `Deine Antwort wurde nicht gespeichert. ${VERSUCHE_ES_ERNEUT_SATZ}`;

/** Shared by every page a token link opens, so none of them alone keeps its token in the address or drops the answer's focus. */
export function useLinkSeite(state: string): { ergebnisRef: RefObject<HTMLElement | null>; answered: () => void } {
  // A count, never a flag: a page still offering a press once answered (the address link's decline after a lapsed
  // confirmation) unmounts that press too, and a flag already set would leave its focus on `<body>`.
  const [answers, setAnswers] = useState(0);
  const ergebnisRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // The bare path after hydration, so the address bar, a screenshot and a bookmark carry no token.
    // Not while the read failed: a reload is the way back, and it needs the token in the URL.
    if (state === "unlesbar" || window.location.search === "") return;
    window.history.replaceState(null, "", window.location.pathname);
  }, [state]);

  // The form unmounts from under the pressed button, so focus would fall to `<body>` with nothing
  // announced; the panel takes it, and `role="status"` reads it out.
  useEffect(() => {
    if (answers > 0) ergebnisRef.current?.focus();
  }, [answers]);

  return { ergebnisRef, answered: () => setAnswers((previous) => previous + 1) };
}

/** One section of a link page. */
export function ConfirmationSection({ titel, children }: { titel: string; children: ReactNode }) {
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
const DETAIL_LABEL_CLASSES = "fluid-xxs font-bold text-foreground-muted";
const DETAIL_VALUE_CLASSES = "fluid-sm";

type Fact = {
  label: string;
  value: string;
  /** The one value nothing bounds — a school's name — which takes the width the others leave. */
  unbounded?: boolean;
};

const fact = tv({
  slots: {
    // `min-w-0` on every cell, or one long word would push the row past the panel's edge.
    cell: "flex min-w-0 flex-col gap-y-0.5",
    value: DETAIL_VALUE_CLASSES,
  },
  variants: {
    unbounded: {
      // A line of its own on a phone; from `sm` it grows into the width the other facts leave.
      true: { cell: "basis-full sm:flex-1", value: NAME_WRAP_CLASSES },
      false: { cell: "flex-initial" },
    },
  },
});

/**
 * The mails' own fact panel in the page's tokens
 * (`fl_frontend/src/core/emailShell.ts :: blockHtml`). **Every value is read whole**: no
 * ellipsis, since a phone has no pointer to hover a `title` with.
 */
export function FactsBanner({ rows }: { rows: readonly Fact[] }) {
  // The mail's 8px rather than a panel's arc, which the page's box count reads as `rounded-2xl`.
  // Wrapping below `sm` alone: from there every fact fits one row, and a stack would spend the first
  // screen on them.
  return (
    <dl className="flex w-full flex-row flex-wrap items-start gap-x-4 gap-y-2 rounded-lg border border-border bg-surface px-4 py-3 text-left sm:flex-nowrap sm:gap-x-6">
      {rows.map(({ label, value, unbounded = false }) => {
        const { cell, value: valueClass } = fact({ unbounded });

        return (
          <div
            key={label}
            className={cell()}>
            <dt className={DETAIL_LABEL_CLASSES}>{label}</dt>
            <dd className={valueClass()}>
              <Value>{value}</Value>
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
export const mediaRow = (media: boolean): { label: string; value: string } => ({
  label: "Fotos, Videos und Interviews",
  value: media ? "erlaubt" : "nicht erlaubt",
});

/**
 * **Sized to its content and never to the width**: two cells spread across a panel put the second
 * alone at the far edge, which reads as a column that lost its table rather than as a pair.
 */
export function SavedDetails({ rows }: { rows: readonly { label: string; value: string }[] }) {
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-3 text-left">
      {rows.map(({ label, value }) => (
        <div
          key={label}
          className="flex flex-col gap-y-0.5">
          <dt className={DETAIL_LABEL_CLASSES}>{label}</dt>
          <dd className={DETAIL_VALUE_CLASSES}>
            <Value>{value}</Value>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The receipt panel: one formula for both tones, a second spelling being one nobody re-measures
 * against the scheme.
 */
const ergebnisPanel = tv({
  base: "flex w-full flex-col items-center gap-y-4 rounded-2xl border p-6 text-center shadow-sm outline-none sm:p-8",
  variants: {
    tone: {
      success: "border-success/40 bg-success/10",
      notice: "border-warning/40 bg-warning/10",
    },
  },
});

const GLYPH = { success: CircleCheck, notice: TriangleExclamation } as const;
const GLYPH_COLOUR_CLASSES = { success: "size-10 text-success-strong", notice: "size-10 text-warning-strong" } as const;

/**
 * Every state but the form is this panel: one box, one glyph, one tone, so a done thing and a dead
 * link are told apart by a grade a reader sees rather than by reading the paragraph.
 */
export function ConfirmationResult({
  panelRef,
  tone,
  children,
}: {
  /** Set where the panel replaced the form under the pressed button, so the caret has somewhere to land. */
  panelRef?: RefObject<HTMLElement | null>;
  tone: "success" | "notice";
  children: ReactNode;
}) {
  const Icon = GLYPH[tone];

  return (
    <section
      ref={panelRef}
      role="status"
      tabIndex={-1}
      className={ergebnisPanel({ tone })}>
      <Icon
        aria-hidden="true"
        className={GLYPH_COLOUR_CLASSES[tone]}
      />
      {children}
    </section>
  );
}

/**
 * **The whole of what a page whose link could not be checked says**: that it does not know. Folded into
 * the dead-link panel, it would call a live link void on a day the backend was merely unreachable.
 */
export function LinkUnreadable({ panelRef }: { panelRef?: RefObject<HTMLElement | null> }) {
  return (
    <ConfirmationResult
      panelRef={panelRef}
      tone="notice">
      <p className={PARAGRAPH_CLASSES}>Wir können diesen Link gerade nicht prüfen. Lade die Seite in ein paar Minuten neu, oder schreib uns.</p>
      <AskQuestion />
    </ConfirmationResult>
  );
}

/** The action a result panel offers, in the width the panel gives it rather than the page's. */
function Action({ children }: { children: ReactNode }) {
  return <div className="flex w-full max-w-xs flex-col">{children}</div>;
}

/** The way back for a reader whose business here is done. */
export function ToLiga() {
  return (
    <Action>
      <Link
        href="/"
        prefetch={false}
        className={ctaButton({ intent: "outline", hover: "css" })}>
        Zur Frankfurt League
      </Link>
    </Action>
  );
}

/** The way out for a reader a panel could not help: a mailbox, never a form they have no link for. */
export function AskQuestion() {
  return (
    <Action>
      <a
        href={`mailto:${KONTAKT_EMAIL}`}
        className={ctaButton({ intent: "primary", hover: "css" })}>
        Frage stellen
      </a>
    </Action>
  );
}
