import { describe, expect, it } from "vitest";

import { markBewerbungDubletten } from "./duplicates.ts";

import type { FLBewerbung } from "@/core/generated/client/types.ts";

/** The four fields the derivation reads, so a fixture is an application without being a whole one. */
type Kandidat = Pick<FLBewerbung, "id" | "saison_id" | "status" | "team_id">;

function bewerbung(
  id: string,
  { team = null, saisonId = "2627", status = "submitted" }: { team?: string | null; saisonId?: string; status?: FLBewerbung["status"] },
): Kandidat {
  return { id: id, saison_id: saisonId, status: status, team_id: team };
}

/* Written out rather than composed by the code under test: the endpoint sends these strings, so a
   literal here is the half of the contract this side has to meet
   (`fl_backend/app/api/bewerbungen/services.py :: dubletten_schluessel_of`). */
const CLUB = "111111111111111111111111";
const CLUB_KOLLIDIERT = `2627 team ${CLUB}`;

describe("applications a triage has to decide between", () => {
  /* The endpoint's cap parted the pair, so this page holds one half and the other is nowhere:
     grouped over the loaded rows alone, the half on screen is a group of one and reads as a clean
     application. */
  it("marks the half of a pair the read's cap left on the page", () => {
    const loadedRows = [bewerbung("a", { team: CLUB }), bewerbung("b", { team: "222222222222222222222222" })];

    expect([...markBewerbungDubletten(loadedRows, [CLUB_KOLLIDIERT])]).toStrictEqual([["a", "team"]]);
  });

  /* The inverse, and the case that fails the moment somebody re-derives the marking from the rows. */
  it("marks nothing the server did not name, whatever the loaded rows share", () => {
    const pairOf = [bewerbung("a", { team: CLUB }), bewerbung("b", { team: CLUB })];

    expect(markBewerbungDubletten(pairOf, []).size).toBe(0);
  });

  /* A decided application is the record its decision was taken against. */
  it("passes over a decided application whose key collides", () => {
    const dubletten = markBewerbungDubletten(
      [bewerbung("a", { team: CLUB, status: "declined" }), bewerbung("b", { team: CLUB })],
      [CLUB_KOLLIDIERT],
    );

    expect([...dubletten.keys()]).toStrictEqual(["b"]);
  });

  /* One club applying in two seasons is two applications. */
  it("keeps two seasons apart", () => {
    const dubletten = markBewerbungDubletten(
      [bewerbung("a", { team: CLUB, saisonId: "2627" }), bewerbung("b", { team: CLUB, saisonId: "2728" })],
      [CLUB_KOLLIDIERT],
    );

    expect([...dubletten.keys()]).toStrictEqual(["a"]);
  });

  /* A new school names no club, so no answer from the server can reach it. */
  it("passes over an application naming no club", () => {
    expect(markBewerbungDubletten([bewerbung("a", {})], [CLUB_KOLLIDIERT]).size).toBe(0);
  });
});
