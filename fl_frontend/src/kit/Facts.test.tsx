// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { Facts } from "./Facts";

// The harm: an address broken anywhere, „konrad.kuhn@examp / le.com“, which reads as two addresses or none. The layout
// is the drive's to measure; this holds where a line may break, as a row's address name does (`Table.test.tsx`): the
// address in its parts, each an element a line takes whole while it fits, after the „@“ and before a „.“.
describe("a fact holding an address", () => {
  it("breaks it after its „@“ first", () => {
    render(
      <Facts
        look="free"
        facts={[{ label: COPY.account.address.current, value: { record: "konrad.kuhn@example.com", address: true } }]}
      />,
    );
    const value = screen.getByRole("definition");

    expect(value.innerHTML.replaceAll(/ class="[^"]*"/gu, "")).toBe("<span>konrad<wbr>.kuhn@</span><wbr><span>example<wbr>.com</span>");
  });
});
