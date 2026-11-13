import { underNext } from "@/test-support/nextContexts";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StepsPage } from "./StepsPage";
import { WholePages } from "./WholePage";

import type { ReactElement } from "react";

describe("a template under `WholePages`", () => {
  // The harm: a boundary of the template's own would commit its placeholder on every click into the page, and the page
  // would arrive in steps again with nothing failing. `WholePages`' own boundary stands where a real load sends its shell.
  it("draws no placeholder of its own while its read runs", async () => {
    const steps = Promise.withResolvers<ReactElement>();
    const stream = await renderToReadableStream(
      underNext(
        <WholePages>
          <StepsPage
            title={{ route: "adminBewerbungen" }}
            wait={<p>placeholder</p>}
            steps={steps.promise}
          />
        </WholePages>,
      ),
    );

    steps.resolve(<p>steps</p>);
    const page = await new Response(stream).text();

    expect(page).toContain("<p>steps</p>");
    expect(page).not.toContain("<p>placeholder</p>");
  });
});
