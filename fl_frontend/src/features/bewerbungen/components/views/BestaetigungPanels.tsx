import { Fragment } from "react";
import Link from "next/link";

import CircleCheck from "@gravity-ui/icons/CircleCheck";
import TriangleExclamation from "@gravity-ui/icons/TriangleExclamation";
import { tv } from "tailwind-variants";

import { KONTAKT_EMAIL } from "@/core/brand";
import { ctaButton } from "@/shared/components/ui/formButtons";
import { formPanel } from "@/shared/components/ui/formPanel";
import { NAME_WRAP } from "@/shared/components/ui/nameWrap";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { textLink } from "@/shared/components/ui/textLink";

import type { ReactNode, RefObject } from "react";

/**
 * The one body step, stamped text and the page's own sentences alike: these are legal words a
 * reader has to get through, so they take the paragraph grade rather than a caption's meta grade.
 */
export const ABSATZ = "fluid-sm text-foreground max-w-2xl leading-relaxed font-medium text-pretty";

/**
 * The one emphasis a reader's own value wears here: a second spelling is how the name in one
 * sentence stops matching the name in the next. `fl_frontend/src/core/emailShell.ts :: strong` is
 * the mail's end of the same rule.
 */
export function Wert({ children }: { children: ReactNode }) {
  return <strong className="text-foreground font-bold">{children}</strong>;
}

/** The `{datenschutz}` slot's value, so the stored sentence and the rendered one read the same. */
const DATENSCHUTZ_TEXT = "Datenschutzerklärung";
const DATENSCHUTZ_SLOT = "datenschutz";

/** Split on the slots themselves, so the capture group keeps each one as a piece of its own. */
const SLOT_TEILER = /(\{\w+\})/;

export type Slots = Readonly<Record<string, string>>;

/** One piece of a split sentence: a slot in whatever its kind earns, or the words as they stand. */
function stueckInhalt(stueck: string, werte: Slots, eigene: ReadonlySet<string>): ReactNode {
  const name = /^\{(\w+)\}$/.exec(stueck)?.[1];

  if (name === undefined) return stueck;
  // Ahead of the record, which holds no value for it: this slot's words are the link's own.
  if (name === DATENSCHUTZ_SLOT) {
    return (
      <Link
        href="/datenschutz"
        prefetch={false}
        className={textLink()}>
        {DATENSCHUTZ_TEXT}
      </Link>
    );
  }

  const wert = werte[name];

  // A slot no record filled stands as written, which is `fl_frontend/src/core/einwilligung.ts ::
  // fuelleFassung`'s rule at the string end.
  if (wert === undefined) return stueck;

  // Emphasis is presentation, so each page decides it here rather than in the stored sentence,
  // whose words and digest do not move for it.
  return eigene.has(name) ? <Wert>{wert}</Wert> : wert;
}

/**
 * A stamped sentence with its slots filled here rather than by `fuelleFassung`, which answers a
 * string: a string cannot carry the mark a reader's own name has to wear, nor the privacy link.
 */
export function Gefuellt({ text, werte, eigene }: { text: string; werte: Slots; eigene: ReadonlySet<string> }) {
  return (
    <>
      {text.split(SLOT_TEILER).map((stueck, index) => (
        <Fragment key={`${String(index)}-${stueck}`}>{stueckInhalt(stueck, werte, eigene)}</Fragment>
      ))}
    </>
  );
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
 * (`fl_frontend/src/features/bewerbungen/components/views/BewerbungAngabenPanel.tsx :: Angabe`),
 * spelled once so the banner and the receipt cannot drift into two type scales.
 */
const ANGABE_LABEL = "fluid-xxs text-foreground-muted font-bold";
const ANGABE_WERT = "fluid-sm";

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
    wert: ANGABE_WERT,
  },
  variants: {
    unbegrenzt: {
      // A line of its own on a phone; from `sm` it grows into the width the other facts leave.
      true: { zelle: "basis-full sm:flex-1", wert: NAME_WRAP },
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
    <dl className="bg-surface border-border flex w-full flex-row flex-wrap items-start gap-x-4 gap-y-2 rounded-lg border px-4 py-3 text-left sm:flex-nowrap sm:gap-x-6">
      {zeilen.map(({ label, wert, unbegrenzt = false }) => {
        const { zelle, wert: wertKlasse } = fakt({ unbegrenzt: unbegrenzt });

        return (
          <div
            key={label}
            className={zelle()}>
            <dt className={ANGABE_LABEL}>{label}</dt>
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
          <dt className={ANGABE_LABEL}>{label}</dt>
          <dd className={ANGABE_WERT}>
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
const GLYPHE_FARBE = { erfolg: "text-success-strong size-10", hinweis: "text-warning-strong size-10" } as const;

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
        className={GLYPHE_FARBE[tone]}
      />
      {children}
    </section>
  );
}

/** The action a result panel offers, in the width the panel gives it rather than the page's. */
export function Aktion({ children }: { children: ReactNode }) {
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
