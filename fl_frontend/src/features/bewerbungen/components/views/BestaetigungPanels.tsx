import { CircleCheck, TriangleExclamation } from "@gravity-ui/icons";
import { tv } from "tailwind-variants";

import { formPanel } from "@/shared/components/ui/formPanel";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";

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

/**
 * The mails' own fact panel in the page's tokens
 * (`fl_frontend/src/core/bewerbungEmail.ts :: renderFakten`). **A row at every width**: three facts
 * stacked down a phone are its whole first screen.
 */
export function FaktenBanner({ zeilen }: { zeilen: readonly { label: string; wert: string }[] }) {
  // The mail's 8px rather than a panel's arc, which the page's box count reads as `rounded-2xl`.
  return (
    <dl className="bg-surface border-border flex w-full flex-row items-start gap-x-4 rounded-lg border px-4 py-3 text-left sm:gap-x-6">
      {zeilen.map(({ label, wert }) => (
        <div
          key={label}
          className="flex min-w-0 flex-1 flex-col gap-y-0.5">
          <dt className={`${ANGABE_LABEL} truncate`}>{label}</dt>
          {/* The row never wraps, so a school name the cell cannot seat is readable nowhere else. */}
          <dd
            className={`${ANGABE_WERT} truncate`}
            title={wert}>
            <Wert>{wert}</Wert>
          </dd>
        </div>
      ))}
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
 * The tint pair is `BewerbungForm.tsx`'s receipt panel, one formula for both tones: a third spelling
 * of a tinted box is one nobody re-measures against the scheme.
 */
const ergebnisPanel = tv({
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
