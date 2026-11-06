// @vitest-environment jsdom

import { createElement as h } from "react";

import { doubleToasts } from "@/test-support/actionDoubles.ts";
import { underNext } from "@/test-support/nextContexts.ts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SPIELER_WORDINGS } from "@/core/consentWordings.ts";

doubleToasts();

const { SpielerBestaetigungView } = await import("@/features/registrierungen/components/views/SpielerBestaetigungView.tsx");

/* Each page a person consents on shows the words its press's labels name: a page reading its own words would have the
   record cite a text the person never saw. */
describe("the consent each page shows", () => {
  it("is the pupil's name wording on the new pupil's registration page", () => {
    const ansicht = {
      state: "valid" as const,
      team: "SG Alpha",
      schule: "Alpha-Schule",
      saison_id: "2026",
      page: "confirmation_spieler" as const,
      minimum_age: 16,
      media_minimum_age: 18,
    };
    render(
      underNext(
        h(SpielerBestaetigungView, {
          start: { state: "valid", ansicht, token: "kein-echtes-token" },
          wording: { page: "confirmation_spieler" },
        }),
      ),
    );

    expect(screen.getByText(SPIELER_WORDINGS.scope.question)).toBeTruthy();
    expect(screen.getByText(SPIELER_WORDINGS.scope.options.internal)).toBeTruthy();
  });
});
