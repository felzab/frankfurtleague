import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { GruppeSelect } = await import("./GruppeSelect.tsx");

const OFFER = [{ gruppe: "A", occupied: 1, capacity: 4 }] as const;

describe("the group picker's name", () => {
  /* Beside its own visible label a second name reads the field out twice, „Gruppe Gruppe“; without that label
     it still needs the one name a screen reader and speech input find it by. */
  it("is „Gruppe“ once, with its own label and without", () => {
    for (const withOwnLabel of [true, false]) {
      const { unmount } = render(h(GruppeSelect, { value: null, onChange: () => undefined, offer: [...OFFER], withOwnLabel }));

      screen.getByRole("button", { name: "Gruppe" });
      unmount();
    }
  });
});
