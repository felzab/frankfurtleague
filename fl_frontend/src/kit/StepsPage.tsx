import { formColumn, RailPage } from "./RailFrame";

import type { ReactElement } from "react";
import type { PageTitle } from "./RailFrame";

/** The run once its records are read. */
async function StepsOnceRead({ steps }: { steps: Promise<ReactElement> }) {
  return await steps;
}

/**
 * A run over several records in the editor's column, each taken in turn and then confirmed once: the title in the strip,
 * and under it the step the run stands at, `StepCard` or `CheckStep`.
 */
export function StepsPage({ title, steps }: { title: PageTitle; steps: Promise<ReactElement> }) {
  return (
    <RailPage
      scope="area"
      title={title}>
      <div className={formColumn()}>
        <StepsOnceRead steps={steps} />
      </div>
    </RailPage>
  );
}
