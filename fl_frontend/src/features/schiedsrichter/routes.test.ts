import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { callPage, clearSteps, OBJECT_ID, readsOf, steps } from "@/shared/testing/pageHarness.ts";

const { default: AdminSchiedsrichterEditPage } = await import("@/app/bereich/admin/schiedsrichter/[schiedsrichter_id]/page.tsx");
const { default: AdminSchiedsrichterPage } = await import("@/app/bereich/admin/schiedsrichter/page.tsx");

/** Every read one page makes, each answered with the emptiest body its schema takes. */
async function readsOfPage<P>(Page: (props: P) => unknown, props: P): Promise<ReturnType<typeof readsOf>> {
  clearSteps();
  const { thrown } = await callPage(Page, props);

  assert.deepEqual(thrown, [], "the page threw before its reads were all made");
  return readsOf(steps);
}

describe("what each referee route asks the endpoint for", () => {
  it("reads the record page by id, the list being narrowed", async () => {
    // The list drops the ghost and every row a filter excludes, so a detail page served from it would
    // answer not-found for a referee whose editor this route is the only way into.
    assert.deepEqual(
      (
        await readsOfPage(AdminSchiedsrichterEditPage, {
          params: Promise.resolve({ schiedsrichter_id: OBJECT_ID }),
          searchParams: Promise.resolve({}),
        })
      ).map(({ endpoint }) => endpoint),
      [`/schiedsrichter/${OBJECT_ID}`],
    );
  });

  it("asks the list page's own read for the retired, whose row here is the only link into their editor", async () => {
    assert.deepEqual(await readsOfPage(AdminSchiedsrichterPage, {}), [{ endpoint: "/schiedsrichter", params: { include_inactive: true } }]);
  });
});
