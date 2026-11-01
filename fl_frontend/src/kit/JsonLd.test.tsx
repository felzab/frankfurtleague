import { renderMarkup } from "@/test-support/renderMarkup";
import { describe, expect, it, vi } from "vitest";

import { OrganizationJsonLd } from "./JsonLd";

import type * as Brand from "@/core/brand";

// A name that would end the block and open a script of its own, were the server to write it as it stands.
const { HOSTILE } = vi.hoisted(() => ({ HOSTILE: '</script><script>alert("x")</script>' }));

vi.mock("@/core/brand", async (original) => ({ ...(await original<typeof Brand>()), VEREIN_NAME: HOSTILE }));

describe("the league's JSON-LD block", () => {
  it("cannot be ended early by a value holding `</script>`, and still reads back as the value", () => {
    const markup = renderMarkup(OrganizationJsonLd, {});
    expect(markup.match(/<\/script/gi)).toHaveLength(1);
    expect(markup.startsWith('<script type="application/ld+json">')).toBe(true);

    const data = JSON.parse(markup.slice(markup.indexOf(">") + 1, markup.lastIndexOf("</script>"))) as Record<string, unknown>;
    expect(data["@type"]).toBe("SportsOrganization");
    expect(data["legalName"]).toBe(HOSTILE);
  });
});
