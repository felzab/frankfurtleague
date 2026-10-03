import ChevronsDownWide from "@gravity-ui/icons/ChevronsDownWide";

import { Disclosure } from "@heroui/react/disclosure";

import { FORM_SECTION_HEADING_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";

import { EinwilligungForm } from "./EinwilligungForm";

import type { ComponentProps, ReactNode } from "react";

/** One consent record on the account page: its control, and the words its person confirmed. */
export type EinwilligungEintrag = ComponentProps<typeof EinwilligungForm> & {
  readonly id: string;
  /** Names the record, so a person holding several reads which one each control moves. */
  readonly titel: string;
  /** The confirmed wording, read-only; `null` where the record names none the registry holds. */
  readonly bestaetigt: ReactNode;
};

/** The words a person agreed to, apart from the control's own: a press changes the choice, never what was agreed. */
const BESTAETIGT_TITEL = "Was Du bestätigt hast";

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
        {eintraege.map(({ id, titel, bestaetigt, ...control }) => (
          <section
            key={id}
            className="flex w-full flex-col gap-y-4">
            <h3 className={FORM_SECTION_HEADING_CLASSES}>{titel}</h3>
            <EinwilligungForm {...control} />
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
