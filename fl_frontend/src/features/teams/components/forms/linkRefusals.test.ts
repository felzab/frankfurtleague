import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { refusalWrappers, renderTree } from "@/shared/testing/renderTest.ts";

import type { FLAddress } from "@/shared/schemas";
import type { FLDraftStatus } from "@/shared/utils/draftStatus.ts";

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { WebsiteUrlField } = await import("./WebsiteUrlField.tsx");
const { FormAdresseSection } = await import("./AdminTeamEditForm/FormAdresseSection.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");

/* The editor's labels read their marker off the draft context. Empty is enough: a path it holds no
   descriptor for renders no marker. */
const NO_DRAFT: FLDraftStatus<string> = { fields: [], byPath: new Map(), changed: [], invalid: [], isDirty: false };

const LEER: FLAddress = { strasse: "", hausnummer: "", plz: "", stadtteil: "", stadt: "" };

const adresse = (address: FLAddress): string =>
  renderTree(
    h(DraftStatusProvider, {
      status: NO_DRAFT,
      children: h(FormAdresseSection, { address, onChange: () => undefined, onFieldLeft: () => undefined }),
    }),
  );

const website = (value: string | null): string => renderTree(h(WebsiteUrlField, { value, onChange: () => undefined }));

/* Both outward links are links rather than buttons, so they are closed by having nowhere to go: the refusal reader
   has to take one, or neither page's reason reaches a test at all. */
describe("an outward link with nowhere to go yet", () => {
  it("names the club's website link by its own label and describes what is missing", () => {
    assert.deepEqual(refusalWrappers(website(null)), [
      { name: "Website in neuem Tab öffnen", label: "Website in neuem Tab öffnen", reason: "Erst eine gültige Adresse eingeben" },
    ]);
  });

  it("names the address's map link by its own label and describes what is missing", () => {
    assert.deepEqual(refusalWrappers(adresse({ ...LEER, strasse: "Feldweg" })), [
      {
        name: "Eingegebene Adresse auf Google Maps öffnen",
        label: "Eingegebene Adresse auf Google Maps öffnen",
        reason: "Erst Straße und Stadt eingeben",
      },
    ]);
  });

  /* The other direction: a link that can be followed is offered, and a refusal read over it would close it for a
     screen reader. */
  it("reads no refusal once the link has somewhere to go", () => {
    assert.deepEqual(refusalWrappers(website("https://www.beispielverein.de")), [], "a followable website link is announced as closed");
    assert.deepEqual(
      refusalWrappers(adresse({ ...LEER, strasse: "Feldweg", hausnummer: "3", stadt: "Frankfurt am Main" })),
      [],
      "a searchable address's map link is announced as closed",
    );
  });
});
