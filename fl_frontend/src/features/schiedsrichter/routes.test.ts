import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { callPage, clearSteps, OBJECT_ID, readsOf, steps } from "@/shared/testing/pageHarness.ts";

import type { PageProps } from "@/shared/testing/pageHarness.ts";

// Typed as the props Next hands every page, which is what the harness calls a page with.
const { default: AdminSchiedsrichterEditPage } = (await import("@/app/admin/schiedsrichter/[schiedsrichter_id]/page.tsx")) as {
  default: (props: PageProps) => unknown;
};
const { default: AdminSchiedsrichterPage } = await import("@/app/admin/schiedsrichter/page.tsx");

/** Every read one page makes, each answered with the emptiest body its schema takes. */
async function readsOfPage(Page: (props: PageProps) => unknown, params: Record<string, unknown>): Promise<ReturnType<typeof readsOf>> {
  clearSteps();
  const { thrown } = await callPage(Page, { params: Promise.resolve(params), searchParams: Promise.resolve({}) });

  assert.deepEqual(thrown, [], "the page threw before its reads were all made");
  return readsOf(steps);
}

describe("what each referee route asks the endpoint for", () => {
  it("reads the record page by id, the list being narrowed", async () => {
    // The list drops the ghost and every row a filter excludes, so a detail page served from it would
    // answer not-found for a referee whose editor this route is the only way into.
    assert.deepEqual(
      (await readsOfPage(AdminSchiedsrichterEditPage, { schiedsrichter_id: OBJECT_ID })).map(({ endpoint }) => endpoint),
      [`/schiedsrichter/${OBJECT_ID}`],
    );
  });

  it("asks the list page's own read for the retired, whose row here is the only link into their editor", async () => {
    assert.deepEqual(await readsOfPage(AdminSchiedsrichterPage, {}), [{ endpoint: "/schiedsrichter", params: { include_inactive: true } }]);
  });
});
