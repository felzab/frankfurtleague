import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderMarkup } from "@/shared/testing/renderTest";

/* Reached after the harness above has evaluated, which is when the JSX compile step is registered. */
const { IN_NEUEM_TAB, NewTabLink } = await import("./NewTabLink.tsx");

describe("a link opening a tab of its own", () => {
  /* The tab it leaves is the page that must outlive the press, and a screen reader is told it does. */
  it("opens its page in a new tab with no handle on this one, and says so after its own words", () => {
    const markup = renderMarkup(NewTabLink, {
      href: "/bereich/admin/registrierungen",
      className: "underline",
      children: "Registrierungen ansehen",
    });

    assert.match(markup, /^<a [^>]*href="\/bereich\/admin\/registrierungen"/);
    assert.match(markup, / target="_blank"/);
    assert.match(markup, / rel="noopener noreferrer"/);
    assert.ok(
      markup.includes(`>Registrierungen ansehen<span class="sr-only"> ${IN_NEUEM_TAB}</span></a>`),
      `the announcement does not follow the link's own words: ${markup}`,
    );
  });
});
