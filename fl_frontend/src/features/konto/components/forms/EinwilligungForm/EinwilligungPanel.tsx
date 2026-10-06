import ChevronsDownWide from "@gravity-ui/icons/ChevronsDownWide";

import { Disclosure } from "@heroui/react/disclosure";

import { FORM_SECTION_HEADING_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { FOCUS_HEADING, focusSection } from "@/shared/utils/focusAfterWrite";

import type { ComponentProps, ReactElement, ReactNode } from "react";
import type { EinwilligungForm } from "./EinwilligungForm";

/**
 * One consent record on the account page: its stored data, its control, and the words its person
 * confirmed. The control comes rendered, each record typing its own choices and its own write.
 */
export type EinwilligungEintrag = {
  readonly id: string;
  /** Names the record, so a person holding several reads which one each control moves. */
  readonly titel: string;
  /** The record's stored data, read-only; absent on a seat, whose data its team's page shows. */
  readonly angaben?: ReactNode;
  /** The confirmed wording, read-only; `null` where the record names none the registry holds. */
  readonly bestaetigt: ReactNode;
  readonly control: ReactElement<ComponentProps<typeof EinwilligungForm>>;
};

/** The words a person agreed to, apart from the control's own: a press changes the choice, never what was agreed. */
const BESTAETIGT_TITEL = "Was Du bestätigt hast";

/** What the league stores on the record, which the stamped words promise the person can see here. */
const ANGABEN_TITEL = "Deine Angaben";

/**
 * The account page's „Deine Einwilligung“ section, one control per record the person holds. Nothing
 * where they hold none: the page is every signed-in person's, most of whom hold no consent.
 */
export function EinwilligungPanel({ eintraege }: { eintraege: readonly EinwilligungEintrag[] }) {
  const panel = formPanel();
  if (eintraege.length === 0) return null;

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Deine Einwilligung"
        />
      </div>
      <div className={panel.body()}>
        {eintraege.map(({ id, titel, angaben, bestaetigt, control }) => (
          // Named by its title: every seat's switches carry the same stamped words, and only the group says
          // which team season a press moves. Its heading takes a closed switch's focus (`docs/frontend/spec.md :: I536`).
          <section
            key={id}
            role="group"
            aria-labelledby={`einwilligung-${id}`}
            {...focusSection(`einwilligung-${id}`)}
            className="flex w-full flex-col gap-y-4">
            <h3
              id={`einwilligung-${id}`}
              {...FOCUS_HEADING}
              className={FORM_SECTION_HEADING_CLASSES}>
              {titel}
            </h3>
            {angaben !== undefined && (
              <div className="flex w-full flex-col gap-y-2">
                {/* A rung under the record's own title, as the confirmed words' trigger below. */}
                <h4 className="fluid-sm font-bold text-foreground">{ANGABEN_TITEL}</h4>
                {angaben}
              </div>
            )}
            {control}
            {bestaetigt !== null && (
              <Disclosure>
                {/* A rung under the record's own title, which the trigger sits inside. */}
                <Disclosure.Heading level={4}>
                  <Disclosure.Trigger className="flex w-fit items-center gap-x-2 fluid-sm font-bold text-foreground">
                    {BESTAETIGT_TITEL}
                    <Disclosure.Indicator className="shrink-0 text-foreground-muted">
                      <ChevronsDownWide
                        aria-hidden="true"
                        className="size-5"
                      />
                    </Disclosure.Indicator>
                  </Disclosure.Trigger>
                </Disclosure.Heading>
                <Disclosure.Content>
                  <Disclosure.Body className="flex flex-col gap-y-3 pt-3">{bestaetigt}</Disclosure.Body>
                </Disclosure.Content>
              </Disclosure>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}
