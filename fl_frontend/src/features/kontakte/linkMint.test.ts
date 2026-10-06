import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { kenntnisnahme } from "@/shared/testing/kenntnisnahme.ts";

import { kontakteMayMoveLinks } from "./linkMint.ts";

import type { FLKontaktperson, FLKontaktpersonPayload } from "@/features/teams/schemas";

const gespeichert = (vorname: string, email: string): FLKontaktperson => ({
  vorname,
  nachname: "Meier",
  email,
  telefon: "069 501",
  geburtsdatum: null,
  einwilligung: kenntnisnahme({ erfasst_von: "administrativ", text_version: "1", datum: "2026-10-03", bestaetigt_am: null }),
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

/* A save that mints or voids a bearer link is a step-up write, and one moving no link keeps its undo
   (`docs/frontend/spec.md :: I432`): each arm a passkey asked too often or a link moved unasked. */
describe("whether a contacts save may move a seat's link", () => {
  it("asks where a seat is filled, handed to another person, or emptied", () => {
    assert.equal(kontakteMayMoveLinks(STORED, block(gesendet("Anna", "anna@schule.example"), gesendet("Bernd", "b@schule.example"))), true);
    assert.equal(kontakteMayMoveLinks(STORED, block(gesendet("Anna", "anna.neu@schule.example"))), true);
    assert.equal(kontakteMayMoveLinks(STORED, block(null)), true, "emptying a seat voids its person's link unasked");
  });

  it("asks nothing where every seat keeps its person, a corrected telephone included", () => {
    assert.equal(kontakteMayMoveLinks(STORED, block(gesendet("Anna", "anna@schule.example", "069 999"))), false);
    assert.equal(kontakteMayMoveLinks(null, block(null)), false);
  });

  /* A confirmed seat's link is spent, so emptying it voids nothing a stranger could still answer
     (`fl_backend/app/api/teams/services.py :: voids_a_live_link`): asked, every such edit would prompt. */
  it("asks nothing where the seat emptied had confirmed", () => {
    const anna = gespeichert("Anna", "anna@schule.example");
    const bestaetigt = {
      ...STORED,
      ansprechperson: {
        ...anna,
        einwilligung: { ...anna.einwilligung, erfasst_von: "person" as const, bestaetigt_am: "2026-10-03" },
      },
    };

    assert.equal(kontakteMayMoveLinks(bestaetigt, block(null)), false);
  });
});
