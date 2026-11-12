import { Suspense } from "react";

import { formColumn, RailPage } from "./RailFrame";
import { Waiting } from "./Skeleton";

import type { ReactElement } from "react";
import type { PageTitle } from "./RailFrame";

/** The run once its records are read. */
async function StepsOnceRead({ steps }: { steps: Promise<ReactElement> }) {
  return await steps;
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
        <Suspense fallback={<Waiting layoutClass="grid gap-6">{wait}</Waiting>}>
          <StepsOnceRead steps={steps} />
        </Suspense>
      </div>
    </RailPage>
  );
}
