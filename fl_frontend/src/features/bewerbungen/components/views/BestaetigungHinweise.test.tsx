// @vitest-environment jsdom

import { createElement as h } from "react";

import { doubleActions, doubleToasts } from "@/test-support/actionDoubles.ts";
import { underNext } from "@/test-support/nextContexts.ts";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SCHIEDSRICHTER_WORDINGS, SEAT_WORDINGS, SPIELER_WORDINGS } from "@/core/consentWordings.ts";

doubleActions({ modules: ["@/features/kontakte/personActions.ts"] });
doubleToasts();

const { BestaetigungFormPanel } = await import("./BestaetigungFormPanel.tsx");
const { SchiedsrichterBestaetigungView } = await import("@/features/schiedsrichter/components/views/SchiedsrichterBestaetigungView.tsx");
const { SpielerBestaetigungView } = await import("@/features/registrierungen/components/views/SpielerBestaetigungView.tsx");
const { EinwilligungForm } = await import("@/features/konto/components/forms/EinwilligungForm/EinwilligungForm.tsx");
const { sitzWorte } = await import("@/features/konto/components/forms/EinwilligungForm/kontoWorte.tsx");

const STAND = { umfang: null, medien: null };
const gespeichert = () => Promise.resolve({ success: true as const, nachweis_stand: STAND });

/* Each page a person consents on shows the words its press's labels name: a page reading its own words would have the
   record cite a text the person never saw. */
describe("the consent each page shows", () => {
  it("is the contact seat's WhatsApp wording on the contact page", () => {
    render(
      underNext(
        h(BestaetigungFormPanel, { token: "kein-echtes-token", mindestalter: 18, medienMindestalter: 18, onAbschluss: () => undefined }),
      ),
    );

    expect(screen.getByRole("switch", { name: SEAT_WORDINGS.umfang.label })).toBeTruthy();
  });

  it("is the referee's name wording on the referee page", () => {
    const ansicht = { state: "valid" as const, frist: "2026-12-01", minimum_age: 16, medien_minimum_age: 18 };
    render(underNext(h(SchiedsrichterBestaetigungView, { start: { zustand: "valid", ansicht: ansicht, token: "kein-echtes-token" } })));

    expect(screen.getByText(SCHIEDSRICHTER_WORDINGS.umfang.question)).toBeTruthy();
    expect(screen.getByText(SCHIEDSRICHTER_WORDINGS.umfang.options.intern)).toBeTruthy();
  });

  it("is the pupil's name wording on the new pupil's registration page", () => {
    const ansicht = {
      state: "valid" as const,
      team: "SG Alpha",
      schule: "Alpha-Schule",
      saison_id: "2026",
      seite: "bestaetigung_spieler" as const,
      minimum_age: 16,
      medien_minimum_age: 18,
    };
    render(
      underNext(
        h(SpielerBestaetigungView, {
          start: { zustand: "valid", ansicht: ansicht, token: "kein-echtes-token" },
          wording: { seite: "bestaetigung_spieler" },
        }),
      ),
    );

    expect(screen.getByText(SPIELER_WORDINGS.umfang.question)).toBeTruthy();
    expect(screen.getByText(SPIELER_WORDINGS.umfang.options.intern)).toBeTruthy();
  });

  it("is the contact seat's two wordings on the account page", () => {
    render(
      underNext(
        h(EinwilligungForm, {
          ...sitzWorte(true),
          gespeichert: { umfang: "kontaktdaten", medien: false },
          nachweisStand: STAND,
          medienAngeboten: true,
          medienMindestalter: 18,
          speichereAction: gespeichert,
        }),
      ),
    );

    expect(screen.getByRole("switch", { name: SEAT_WORDINGS.umfang.label })).toBeTruthy();
    expect(screen.getByRole("switch", { name: SEAT_WORDINGS.medien.label })).toBeTruthy();
  });
});
