import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { einwilligungAnswer, publishedLaufendeFassung } from "@/core/einwilligungDocument.ts";
import { registerDoubles } from "@/core/exportingModule.ts";
import { doubleSendMail } from "@/core/mailDouble.ts";
import { cacheCalls } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import { publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";
import { assertEachRefusalCloses, doubleRouteRequest, unacknowledged, undo } from "@/shared/testing/undoRoutes.ts";

/** The stored block the press replays, and the token the save left, as the editor builds them. */
const BODY = { team_id: "6890a1b2c3d4e5f607182932", saison_id: "2026", kontakte: null, kontakte_stand: "9f2c" };
const SAISON_TEAM_ID = "6890a1b2c3d4e5f6071f0001";

/** The label the backend runs on the application form, off the registry it generated. */
const FORM_LABEL = publishedLaufendeFassung("bewerbung").text_version;

/** An earlier person put back on the Ansprechperson seat, under the running label. */
const ZURUECK = {
  ...BODY,
  kontakte: {
    trainer: null,
    ansprechperson: {
      vorname: "Ada",
      nachname: "Byron",
      email: "ada@example.org",
      telefon: "069 111",
      einwilligung: { umfang: "kontaktdaten", text_version: FORM_LABEL, datum: "2026-03-12" },
    },
    stellvertretung: null,
    trainer_ist_zugleich: null,
  },
};

/** The link the replay minted for the person it put back. */
const MINT = {
  token: "zurueck",
  rollen: ["ansprechperson"],
  email: "ada@example.org",
  vorname: "Ada",
  schule: "Lessing-Kolleg",
  frist: "2026-10-17",
  zeile: "offen",
};

/** The replay's answer as the backend sends it: the row's block, and the token the replay left. */
const replayed = (acknowledged: 0 | 1, bestaetigungen: unknown[] = []) => ({
  acknowledged,
  team_id: BODY.team_id,
  saison_id: BODY.saison_id,
  saison_team_id: SAISON_TEAM_ID,
  kontakte: null,
  kontakte_stand: "a1b2",
  bestaetigungen,
});

/* The real route, the save's own mutation and the link mailer, called: the request it runs in, the
   backend client and the mail transport are the doubles. */
const { setFresh } = doubleRouteRequest();
const mail = doubleSendMail();
registerDoubles({ modules: { "core/config.ts": { frontend_config: { AUTH_URL: "http://localhost:3000" } } } });
/** The stored rows a stale replay is judged against: none, so only a replay seating somebody moves a link. */
const NO_CLUB = { acknowledged: 1, teams: [] };
type Answer = NonNullable<Parameters<typeof doubleApiAnswers>[0]>;
/** `answer`, with the running labels read off the registry, which a replay seating somebody reads first. */
const mitSeiten =
  (answer: Answer): Answer =>
  (call) =>
    call.endpoint === "/einwilligung/seiten" ? Promise.resolve(einwilligungAnswer(call.endpoint)) : answer(call);
const doubled = doubleApiAnswers(
  mitSeiten(({ endpoint }) =>
    Promise.resolve(
      endpoint.startsWith("/zustellung/") ? { acknowledged: 1, angewendet: true } : endpoint === "/teams/memberships" ? NO_CLUB : replayed(1),
    ),
  ),
);
const { calls } = doubled;
const answerWith = (answer: Answer) => doubled.answerWith(mitSeiten(answer));
const { POST } = await import("./route.ts");
const { stepUpRequired } = await import("@/shared/utils/adminMutation.ts");

/** What `fl_frontend/src/features/kontakte/mutations.ts :: patchSaisonTeamKontakte` sends, as the backend's own routes spell it. */
const REPLAY_OPERATION = "PATCH /teams/{team_id}/saisons/{saison_id}/kontakte";

/** The request the save's own write sends for `payload`: the block to the junction row's contacts path. */
const saveOf = ({ team_id, saison_id, ...block }: { team_id: string; saison_id: string; [field: string]: unknown }) => ({
  endpoint: `/teams/${team_id}/saisons/${saison_id}/kontakte`,
  method: "PATCH",
  body: block,
});

/** The one code whose sentence already says the undo did not run, so it closes on its own words. */
const STALE_BLOCK = "REQ-KONTAKT-001";

describe("the contacts save's undo", () => {
  it("replays the save's own payload through the save's own write", async () => {
    const answer = await undo(POST, BODY);

    assert.equal(answer.success, true, String(answer.error));
    assert.deepEqual(requestsOf(calls), [saveOf(BODY)]);
  });

  /* A person put back is entered anew, which the backend admits under the running label alone
     (`docs/backend/spec.md :: I866`), whatever label that person accepted before. */
  it("replays every seat under the label the form runs, whatever label the earlier record stored", async () => {
    const seat = (textVersion: string) => ({
      vorname: "Ada",
      nachname: "Byron",
      email: "ada@example.org",
      telefon: "069 111",
      einwilligung: { umfang: "kontaktdaten", text_version: textVersion, datum: "2026-03-12" },
    });
    const block = (textVersion: string) => ({
      trainer: seat(textVersion),
      ansprechperson: null,
      stellvertretung: null,
      trainer_ist_zugleich: null,
    });

    const answer = await undo(POST, { ...BODY, kontakte: block("eine-fruehere-fassung") });

    assert.equal(answer.success, true, String(answer.error));
    assert.deepEqual(
      requestsOf(calls).filter(({ method }) => method !== undefined),
      [saveOf({ ...BODY, kontakte: block(FORM_LABEL) })],
    );
  });

  /* An undo clearing the block puts nobody back, so it has no label to name and reads none. */
  it("reads no label for a replay clearing the block", async () => {
    await undo(POST, BODY);

    assert.equal(
      calls.some(({ endpoint }) => endpoint === "/einwilligung/seiten"),
      false,
    );
  });

  /* Undoing a first entry clears the block, which the clearing panel asks the passkey for
     (`docs/frontend/spec.md :: I432`); any other replay keeps its undo unasked. */
  it("refuses a replay clearing the block from a session past the step-up window, and no other", async () => {
    setFresh(false);
    const clearing = await undo(POST, BODY);
    assert.deepEqual(clearing, { ...stepUpRequired() }, "a stale session cleared a club's contacts through the undo");
    assert.deepEqual(calls, [], "the clearing replay reached the backend for a session past the window");

    const seats = { trainer: null, ansprechperson: null, stellvertretung: null, trainer_ist_zugleich: null };
    const restoring = await undo(POST, { ...BODY, kontakte: seats });
    assert.equal(restoring.success, true, "a stale session was refused a replay restoring seats");
  });

  /* No cached read holds a contact person, so an invalidation here would clear what the replay never moved. */
  it("clears no cached read, whether the replay lands or is refused", async () => {
    await undo(POST, BODY);
    answerWith(() => Promise.reject(refusedOn(REPLAY_OPERATION, "REQ-KONTAKT-003")));
    await undo(POST, BODY);

    assert.deepEqual(cacheCalls, []);
  });

  it("replays nothing for a body the save's schema refuses, or a caller from another site", async () => {
    const withoutToken = await undo(POST, { ...BODY, kontakte_stand: undefined });
    const crossSite = await undo(POST, BODY, "cross-site");

    assert.equal(withoutToken.success, false);
    assert.equal(crossSite.success, false);
    assert.deepEqual(calls, []);
  });

  it("words every other refusal the replayed endpoint publishes, closing on the change standing once", async () => {
    await assertEachRefusalCloses({
      codes: publishedRefusals(REPLAY_OPERATION).filter((code) => code !== STALE_BLOCK),
      refuse: (code) => answerWith(() => Promise.reject(refusedOn(REPLAY_OPERATION, code))),
      press: () => undo(POST, BODY),
    });
  });

  /* The save's own sentence sends the admin to a form this toast has not got, and the change standing
     after it would say twice that the undo did not run. */
  it("words the stale block for the undo, saying why it did not run", async () => {
    answerWith(() => Promise.reject(refusedOn(REPLAY_OPERATION, STALE_BLOCK)));

    const answer = await undo(POST, BODY);

    assert.deepEqual(answer, {
      success: false,
      error:
        "Die Kontakte dieser Saison wurden nach dem Speichern erneut geändert, etwa weil eine Kontaktperson ihren Eintrag bestätigt oder ihm widersprochen hat oder gelöscht wurde. " +
        "Die Rücknahme wurde nicht ausgeführt, damit sie die neueren Angaben nicht überschreibt.",
    });
  });

  /* Putting an earlier person back seats them anew, which the endpoint mints for: unmailed, the token
     exists in the database alone, and the undo has mailed a person, which the toast must say. */
  it("mails the link a replay minted, to the address the mint names, and says so", async () => {
    answerWith(({ endpoint }) =>
      Promise.resolve(
        endpoint.startsWith("/zustellung/")
          ? { acknowledged: 1, angewendet: true }
          : endpoint === "/teams/memberships"
            ? NO_CLUB
            : replayed(1, [MINT]),
      ),
    );

    const answer = await undo(POST, ZURUECK);

    assert.equal(answer.success, true, String(answer.error));
    assert.deepEqual(
      mail.sent.map(({ to, tags }) => [to, tags?.ziel, tags?.rollen]),
      [["ada@example.org", "kontakt", "ansprechperson"]],
    );
    assert.match(JSON.stringify(answer), /Der Bestätigungslink ging an ada@example\.org\./);
  });

  /* A replay seating somebody on a season that is over mints a link taking the Widerspruch alone, so
     its message asks for no confirmation, as the save's own does. */
  it("mails a person a replay put back on a season that is over the Widerspruch alone", async () => {
    answerWith(({ endpoint }) =>
      Promise.resolve(
        endpoint.startsWith("/zustellung/")
          ? { acknowledged: 1, angewendet: true }
          : endpoint === "/teams/memberships"
            ? NO_CLUB
            : replayed(1, [{ ...MINT, zeile: "saison_vorbei" }]),
      ),
    );

    const answer = await undo(POST, ZURUECK);

    assert.equal(answer.success, true, String(answer.error));
    assert.match(mail.sent[0]?.text ?? "", /Die Saison ist vorbei/);
    assert.doesNotMatch(mail.sent[0]?.text ?? "", /Bitte bestätige/);
  });

  /* The replay is a save: one seating a person the row does not hold mints, so a stale session is asked
     for the passkey before it, as the save's own action asks (`docs/frontend/spec.md :: I432`). */
  it("refuses a replay seating someone the row does not hold from a session past the window", async () => {
    setFresh(false);
    answerWith(({ endpoint }) => Promise.resolve(endpoint === "/teams/memberships" ? { acknowledged: 1, teams: [] } : replayed(1)));

    assert.deepEqual(await undo(POST, ZURUECK), { ...stepUpRequired() });
    assert.deepEqual(
      requestsOf(calls).filter(({ method }) => method !== undefined),
      [],
      "the minting replay reached the backend for a session past the window",
    );
  });

  /* It may still have landed, so it is titled unclear and never says the change stands. */
  it("answers an unacknowledged replay as of unknown outcome, sending the admin to the contacts", async () => {
    answerWith(() => Promise.resolve(replayed(0)));

    assert.deepEqual(await undo(POST, BODY), unacknowledged("Die Rücknahme wurde abgebrochen. Prüfe die Kontaktdaten."));
  });
});
