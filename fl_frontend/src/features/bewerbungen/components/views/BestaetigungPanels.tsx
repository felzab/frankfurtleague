import { CircleCheck, TriangleExclamation } from "@gravity-ui/icons";
import { tv } from "tailwind-variants";

import { formPanel } from "@/shared/components/ui/formPanel";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";

import type { ReactNode, RefObject } from "react";

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
 * The stored facts a reader is shown back, in the admin application page's own grid
 * (`fl_frontend/src/features/bewerbungen/components/views/BewerbungAngabenPanel.tsx :: Angabe`): a
 * label over its value, so no row needs a box of its own to be read as a pair.
 */
export function Fakten({ zeilen }: { zeilen: readonly { label: string; wert: string }[] }) {
  return (
    <dl className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {zeilen.map(({ label, wert }) => (
        <div
          key={label}
          className="flex flex-col gap-y-0.5">
          <dt className="fluid-xxs text-foreground-muted font-bold">{label}</dt>
          <dd className="fluid-sm min-w-0 break-words">
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
