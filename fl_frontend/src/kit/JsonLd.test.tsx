import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { VEREIN_NAME } from "@/core/brand";

import { OrganizationJsonLd } from "./JsonLd";

/** The organisation the block publishes, read back as a search engine reads it. */
function published(): Record<string, unknown> {
  const markup = renderToStaticMarkup(<OrganizationJsonLd />);
  const found = /^<script type="application\/ld\+json">(.*)<\/script>$/s.exec(markup);
  expect(found, `no data block in ${markup}`).not.toBeNull();

  return JSON.parse(found?.[1] ?? "{}") as Record<string, unknown>;
}

describe("the league's structured data", () => {
  /* A machine compares the legal name as the register spells it, where a no-break space is another character; the
     screen's name keeps its no-break space and is the same name otherwise. */
  it("publishes the legal name with plain spaces, the screen's name in every other character", () => {
    const { legalName } = published();

    expect(legalName).toBe("Frankfurt League e. V.");
    expect(VEREIN_NAME).toContain(" ");
    expect(VEREIN_NAME.replace(" ", " ")).toBe(legalName);
  });
});
