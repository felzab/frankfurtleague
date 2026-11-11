// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { Facts } from "./Facts";

// The harm: an address broken anywhere, „konrad.kuhn@examp / le.com“, which reads as two addresses or none. The layout
// is the drive's to measure; this holds what the break rests on, as a row's address name does (`Table.test.tsx`).
describe("a fact holding an address", () => {
  it("breaks it after its „@“ first, never anywhere", () => {
    render(
      <Facts
        look="free"
        facts={[{ label: COPY.account.address.current, value: { record: "konrad.kuhn@example.com", address: true } }]}
      />,
    );
    const value = screen.getByRole("definition");

    expect(value.innerHTML).toBe('<span class="inline-block">konrad<wbr>.kuhn@</span><wbr><span class="inline-block">example<wbr>.com</span>');
    expect(value.className.split(" ")).not.toContain("wrap-anywhere");
  });
});
