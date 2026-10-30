import { kenntnisnahme } from "@/test-support/kenntnisnahme.ts";
import { describe, expect, it } from "vitest";

import { kontakteMayMoveLinks } from "./linkMint.ts";

import type { FLKontaktperson, FLKontaktpersonPayload } from "@/core/generated/client/types";

const gespeichert = (vorname: string, email: string): FLKontaktperson => ({
  vorname,
  nachname: "Meier",
  email,
  telefon: "069 501",
  geburtsdatum: null,
  einwilligung: kenntnisnahme({ text_version: "1", datum: "2026-10-03", bestaetigt_am: null }),
});
const gesendet = (vorname: string, email: string, telefon = "069 501"): FLKontaktpersonPayload => ({
  vorname,
  nachname: "Meier",
  email,
  telefon,
  einwilligung: { umfang: "kontaktdaten", text_version: "1", datum: "2026-10-03" },
});

const STORED = { trainer: null, ansprechperson: gespeichert("Anna", "anna@schule.example"), stellvertretung: null, trainer_ist_zugleich: null };
const block = (ansprechperson: FLKontaktpersonPayload | null, stellvertretung: FLKontaktpersonPayload | null = null) => ({
  trainer: null,
  ansprechperson,
  stellvertretung,
  trainer_ist_zugleich: null,
});

/* A save that mints or voids a bearer link is a step-up write, and one moving no link is not:
   each arm a passkey asked too often or a link moved unasked. */
describe("whether a contacts save may move a seat's link", () => {
  it("asks where a seat is filled, handed to another person, or emptied", () => {
    expect(kontakteMayMoveLinks(STORED, block(gesendet("Anna", "anna@schule.example"), gesendet("Bernd", "b@schule.example")))).toBe(true);
    expect(kontakteMayMoveLinks(STORED, block(gesendet("Anna", "anna.neu@schule.example")))).toBe(true);
    expect(kontakteMayMoveLinks(STORED, block(null)), "emptying a seat voids its person's link unasked").toBe(true);
  });

  it("asks nothing where every seat keeps its person, a corrected telephone included", () => {
    expect(kontakteMayMoveLinks(STORED, block(gesendet("Anna", "anna@schule.example", "069 999")))).toBe(false);
    expect(kontakteMayMoveLinks(null, block(null))).toBe(false);
  });

  /* A confirmed seat's own link is spent, but its links on the team's match confirmations that season, answered and
     closed ones too, die with it, which only a read could rule out (`fl_backend/app/api/teams/services.py :: voids_a_live_link`). */
  it("asks where the seat emptied had confirmed", () => {
    const anna = gespeichert("Anna", "anna@schule.example");
    const bestaetigt = {
      ...STORED,
      ansprechperson: {
        ...anna,
        einwilligung: { ...anna.einwilligung, bestaetigt_am: "2026-10-03" },
      },
    };

    expect(kontakteMayMoveLinks(bestaetigt, block(null))).toBe(true);
  });
});
