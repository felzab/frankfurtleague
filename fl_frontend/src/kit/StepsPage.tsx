import { COPY } from "@/core/copy";

import { buttonPlaceholder } from "./buttonStyles";
import { CardPlaceholder } from "./Card";
import { ActRow } from "./Dialog";
import { FactsPlaceholder } from "./Facts";
import { statusLine } from "./fieldStyles";
import { PageWait } from "./PageFade";
import { formColumn, RailPage } from "./RailFrame";
import { Waiting } from "./Skeleton";

import type { ReactElement, ReactNode } from "react";
import type { PageTitle } from "./RailFrame";

/** The run once its records are read. */
async function StepsOnceRead({ steps }: { steps: Promise<ReactElement> }) {
  return await steps;
}

/** A record's card while the run is read, as `StepCard` sets it: its head, `facts` of its facts, its inputs' placeholders and its acts. */
export function StepCardPlaceholder({ facts, children }: { facts: number; children: ReactNode }) {
  return (
    <CardPlaceholder
      line
      body="fields">
      <div className="grid gap-4">
        <FactsPlaceholder pairs={facts} />
        <div className="grid justify-items-start gap-4">{children}</div>
        <ActRow>
          <span className={statusLine({ placement: "row" })} />
          <span className={buttonPlaceholder()}>{COPY.shared.verb.skip}</span>
          <span className={buttonPlaceholder()}>{COPY.shared.verb.next}</span>
        </ActRow>
      </div>
    </CardPlaceholder>
  );
}

/**
 * A run over several records in the editor's column, each taken in turn and then confirmed once: the title in the strip,
 * and under it the step the run stands at, `StepCard` or `CheckStep`, `wait` the first card's placeholder while the
 * records are read.
 */
export function StepsPage({ title, wait, steps }: { title: PageTitle; wait: ReactElement; steps: Promise<ReactElement> }) {
  return (
    <RailPage
      scope="area"
      title={title}>
      <div className={formColumn()}>
        <PageWait fallback={<Waiting layout="grid gap-6">{wait}</Waiting>}>
          <StepsOnceRead steps={steps} />
        </PageWait>
      </div>
    </RailPage>
  );
}
