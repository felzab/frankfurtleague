import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render } from "@testing-library/react";

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { AddressFields } = await import("./AddressFields.tsx");
const { WebsiteUrlField } = await import("@/features/teams/components/forms/WebsiteUrlField.tsx");

const ADDRESS = { strasse: "Am Sportpark", hausnummer: "1", plz: "60435", stadtteil: "Nordend", stadt: "Frankfurt am Main" };

/**
 * The address editor's rows that seat two fields beside each other, never the column stacking those
 * rows: the pair is the shape a specified width overflows, and the column has no pair in it.
 */
function pairRows(): Element[][] {
  const { container } = render(h(AddressFields, { value: ADDRESS, onChange: () => undefined }));

  return [...container.querySelectorAll("div.flex:not(.flex-col)")].map((row) =>
    [...row.children].filter((child) => child.getAttribute("data-slot") === "textfield"),
  );
}

/** A width the element fixes for itself. `min-w-0` is the one exception, that class REMOVING a floor. */
const SPECIFIED_WIDTH = /^(?:w|min-w|basis)-(?!0$)/;

describe("the two fields an address row seats side by side", () => {
  it("finds both rows, and two fields in each", () => {
    // A floor before the case below, which a render that matched nothing would leave vacuously true.
    const rows = pairRows();
    assert.equal(rows.length, 2, "the address editor no longer renders its two paired rows");

    for (const row of rows) {
      assert.equal(row.length, 2, "a paired row no longer seats two fields");
    }
  });

  /* The split is over the FREE space, which the gap comes out of first: two widths summing to the
     container put the whole gap past it, and no shrinking reclaims any of it while a flex item's
     automatic minimum is its own input's intrinsic width. */
  it("floors neither field at its own width, and leaves the gap its room", () => {
    for (const field of pairRows().flat()) {
      const classes = [...field.classList];
      const list = classes.join(" ");

      assert.ok(classes.includes("min-w-0"), `${list}: the field cannot shrink under the intrinsic width of its input`);
      assert.ok(
        classes.some((name) => /^flex-\d+$/.test(name)),
        `${list}: the field takes its share of something other than the free space`,
      );
      assert.ok(
        !classes.some((name) => SPECIFIED_WIDTH.test(name)),
        `${list}: a width the field fixes for itself leaves the gap standing outside the row`,
      );
    }
  });
});

describe("the box inside the website field's group", () => {
  /* HeroUI gives the group's input `flex: 1` and no floor of its own, so its automatic minimum is the
     browser's default input width, wider than the room the prefix leaves it. Both levels: a floor on
     the group stops the shrinking above the input. */
  it("lets the shrinking reach the input rather than flooring it at its intrinsic width", () => {
    const { container } = render(h(WebsiteUrlField, { value: "https://example.org", onChange: () => undefined }));

    for (const slot of ["input-group", "input-group-input"]) {
      const element = container.querySelector(`[data-slot="${slot}"]`) ?? assert.fail(`the website field renders no ${slot}`);

      assert.ok(element.classList.contains("min-w-0"), `${slot}: an automatic minimum floors it, and the row cannot shrink past it`);
    }
  });
});
