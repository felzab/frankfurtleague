import { CardPlaceholder } from "./Card";
import { FactsPlaceholder } from "./Facts";
import { FieldPlaceholder } from "./FieldPair";
import { PageWait } from "./PageFade";
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
 * and under it the step the run stands at, `StepCard` or `CheckStep`, the first card's placeholder while the records are read.
 */
export function StepsPage({ title, steps }: { title: PageTitle; steps: Promise<ReactElement> }) {
  return (
    <RailPage
      scope="area"
      title={title}>
      <div className={formColumn()}>
        <PageWait
          fallback={
            <Waiting layout="grid gap-6">
              <CardPlaceholder>
                <div className="grid gap-4 p-4">
                  <FactsPlaceholder pairs={4} />
                  <FieldPlaceholder width="W3" />
                  <FieldPlaceholder width="W3" />
                </div>
              </CardPlaceholder>
            </Waiting>
          }>
          <StepsOnceRead steps={steps} />
        </PageWait>
      </div>
    </RailPage>
  );
}
