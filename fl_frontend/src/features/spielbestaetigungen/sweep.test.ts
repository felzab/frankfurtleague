import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "node:test";

import { ACTOR_KEY_FILE } from "@/core/authDoubles.ts";
import { registerDoubles } from "@/core/exportingModule.ts";
import { doubleSendMail } from "@/core/mailDouble.ts";
import { doubleApiClient } from "@/shared/testing/apiClientDouble.ts";

import type { MailOutcome, SentMail } from "@/core/mailDouble.ts";
import type { ApiCall } from "@/shared/testing/apiClientDouble.ts";

/** One thing that happened, in the order it happened: the stamp's order against the mail is what this slice owes. */
type Ereignis = { art: "api"; endpoint: string; body: unknown } | { art: "mail"; mail: SentMail } | { art: "drop"; tags: readonly string[] };

const ereignisse: Ereignis[] = [];

/** Every line as it was written, its fields whole. */
const lines: { level: "info" | "warn" | "error"; event: string; fields: unknown }[] = [];

let sweepSwitch: string | undefined = "on";
/** Whether the notices' stamp fails, as a backend restarting under it fails it. */
let mitgeteiltScheitert = false;
let appEnv = "production";

const LISTE = "/spielbestaetigungen/sweep";
const PASS = (saisonId: string) => `/spielbestaetigungen/sweep/${saisonId}`;
const ANGEFRAGT = (saisonId: string) => `/spielbestaetigungen/sweep/${saisonId}/angefragt`;
const MITGETEILT = (saisonId: string) => `/spielbestaetigungen/sweep/${saisonId}/mitgeteilt`;

/** The listing's answer, and each season's pass's, which a case sets. */
let listeAnswer: () => unknown = () => ({ acknowledged: 1, saison_ids: [], spiel_sweep_gelaufen_am: null });
let passAnswer: (saisonId: string) => unknown = (saisonId) => leererPass(saisonId);

/** Ids in the `_id` alphabet, one per row a case names. */
const id = (n: number): string => n.toString(16).padStart(24, "a");

const leererPass = (saisonId: string) => ({
  acknowledged: 1,
  saison_id: saisonId,
  anfragen: [],
  erinnerungen: [],
  einteilungen: [],
  neue_ansetzungen: [],
  schiedsrichter_neue_ansetzungen: [],
  schiedsrichter_gewechselt: [],
  spiel_abgesagt: [],
  schiedsrichter_spiel_abgesagt: [],
  vorschlag_verworfen: [],
  geschlossen: 0,
  fehlgeschlagen: 0,
  mitteilungen_aufgegeben: [],
});

/** One notice's slot and clubs, each kind carrying them alike. */
const hinweis = (n: number) => ({
  spielbestaetigung_id: id(n),
  spiel_id: id(500),
  team1_name: "Ernst-Reuter-Schule",
  team2_name: "Goethe-Gymnasium",
  alt: { datum: "2026-11-13", uhrzeit: "10:00:00" },
});

/** A fixture dated 20.11.2026, whose deadline the pass answers as 10.11.2026 rather than seven days before it. */
const ANSETZUNG = {
  team1_name: "Ernst-Reuter-Schule",
  team2_name: "Goethe-Gymnasium",
  datum: "2026-11-20",
  uhrzeit: "14:30:00",
  spielort: { spielort_id: id(900), name: "Sportpark Rebstock", maps_link: "Sportpark Rebstock, Frankfurt" },
};

/** One row asked of one mailbox, its link the row's own. */
const anfrage = (n: number, address: string) => ({
  spielbestaetigung_id: id(n),
  spiel_id: id(500),
  seite: "team2" as const,
  ansetzung: ANSETZUNG,
  frist: "2026-11-10",
  links: [{ address: address, rollen: ["ansprechperson"], token: `token-${String(n)}` }],
});

/** One row asked of two mailboxes, a link each, in the order given. */
const zweiLinks = (n: number, erste: string, zweite: string) => ({
  ...anfrage(n, erste),
  links: [
    { address: erste, rollen: ["ansprechperson"], token: `token-${String(n)}a` },
    { address: zweite, rollen: ["trainer"], token: `token-${String(n)}b` },
  ],
});

const einteilung = (n: number, address: string) => ({ spielbestaetigung_id: id(n), spiel_id: id(500), ansetzung: ANSETZUNG, address: address });

doubleApiClient(async (call: ApiCall, schema) => {
  // The grants' pass is armed by the same boot and answers to its own suite: here it claims nothing and is not recorded.
  if (call.endpoint.startsWith("/berechtigungen")) {
    return schema.parse({ acknowledged: 1, beanspruchung: null, beansprucht_bis: null, aenderungen: [], empfaenger: [], uebersprungen: 0 });
  }
  // The delivery record an accepted send files, which the backend applies; not this pass's own call.
  if (call.endpoint.startsWith("/zustellung/")) return schema.parse({ acknowledged: 1, angewendet: true });

  const body: unknown = call.body === undefined ? undefined : JSON.parse(call.body);
  ereignisse.push({ art: "api", endpoint: call.endpoint, body: body });
  // Parsed by the mirror the real client parses with, so an answer this file composes cannot drift.
  if (call.endpoint === LISTE) return schema.parse(await listeAnswer());
  const angefragt = /^\/spielbestaetigungen\/sweep\/(\d+)\/angefragt$/.exec(call.endpoint);
  if (angefragt !== null) {
    const ids = (body as { spielbestaetigung_ids: string[] }).spielbestaetigung_ids;
    return schema.parse({ acknowledged: 1, saison_id: angefragt[1], angefragt: ids.length, fehlgeschlagen: 0 });
  }
  const mitgeteilt = /^\/spielbestaetigungen\/sweep\/(\d+)\/mitgeteilt$/.exec(call.endpoint);
  if (mitgeteilt !== null) {
    if (mitgeteiltScheitert) throw new Error("the notices' stamp went unanswered");
    const ids = (body as { spielbestaetigung_ids: string[] }).spielbestaetigung_ids;
    return schema.parse({ acknowledged: 1, saison_id: mitgeteilt[1], mitgeteilt: ids.length });
  }
  const pass = /^\/spielbestaetigungen\/sweep\/(\d+)$/.exec(call.endpoint);
  assert.ok(pass !== null, `the pass reached a route nothing here answers: ${call.endpoint}`);
  return schema.parse(passAnswer(pass[1] ?? ""));
});

const mail = doubleSendMail();
/** How the mailer ends a message to each address a case names; every other address is accepted. */
const ausgang = new Map<string, MailOutcome>();

const LOGGING_DOUBLE = {
  logger: {
    debug: () => undefined,
    info: (event: string, fields?: unknown) => void lines.push({ level: "info", event, fields }),
    warn: (event: string, fields?: unknown) => void lines.push({ level: "warn", event, fields }),
    error: (event: string, _message: unknown, fields?: unknown) => void lines.push({ level: "error", event, fields }),
  },
};

// Getters, not values: one process holds one module registry, so a case that could not re-read a switch could only
// ever prove one side of it.
const CONFIG_DOUBLE = {
  frontend_config: {
    LOG_FORMAT: "console",
    AUTH_URL: "http://localhost:3000",
    // The boot reads the signing key before it arms anything.
    ACTOR_SIGNING_KEY_FILE: ACTOR_KEY_FILE,
    get SPIEL_SWEEP() {
      return sweepSwitch;
    },
    get APP_ENV() {
      return appEnv;
    },
  },
};

registerDoubles({
  modules: {
    "core/logging.ts": LOGGING_DOUBLE,
    "core/config.ts": CONFIG_DOUBLE,
    // A production boot builds the sign-in store's indexes too, over a client this suite never configures.
    "core/authIndexes.ts": { buildAuthIndexes: () => Promise.resolve() },
    // The loopback call reaches a server no test process runs; its pairing with the route is the route's own suite's.
    "core/revalidation.ts": { revalidateOverLoopback: async (tags: readonly string[]) => void ereignisse.push({ art: "drop", tags: tags }) },
  },
});

const { register } = await import("../../instrumentation.ts");
const { runSpielSweep } = await import("./sweep.ts");

const SEKUNDE_MS = 1000;
const MINUTE_MS = 60 * SEKUNDE_MS;
const HOUR_MS = 60 * MINUTE_MS;

const apiCalls = () => ereignisse.filter((ereignis): ereignis is Extract<Ereignis, { art: "api" }> => ereignis.art === "api");
const drops = () => ereignisse.filter((ereignis): ereignis is Extract<Ereignis, { art: "drop" }> => ereignis.art === "drop");
const gesendet = () => mail.sent;
/** The ids the stamp was handed, over every stamp call of the pass. */
const gestempelt = () =>
  apiCalls()
    .filter(({ endpoint }) => endpoint.endsWith("/angefragt"))
    .flatMap(({ body }) => (body as { spielbestaetigung_ids: string[] }).spielbestaetigung_ids);
/** The ids the notices' stamp was handed, over every such call of the pass. */
const mitgeteilt = () =>
  apiCalls()
    .filter(({ endpoint }) => endpoint.endsWith("/mitgeteilt"))
    .flatMap(({ body }) => (body as { spielbestaetigung_ids: string[] }).spielbestaetigung_ids);
const passLines = () => lines.filter(({ event }) => event.startsWith("spielbestaetigung."));

beforeEach(() => {
  ereignisse.length = 0;
  lines.length = 0;
  ausgang.clear();
  sweepSwitch = "on";
  mitgeteiltScheitert = false;
  appEnv = "production";
  listeAnswer = () => ({ acknowledged: 1, saison_ids: ["2627"], spiel_sweep_gelaufen_am: null });
  passAnswer = (saisonId) => leererPass(saisonId);
  mail.answerWith((sent) => {
    // Recorded here as well, so a message and a call stay in the order they ran.
    ereignisse.push({ art: "mail", mail: sent });
    return ausgang.get(sent.to) ?? "accepted";
  });
});

describe("what register arms for the fixture confirmations", () => {
  // Next declares `NODE_ENV` read-only, which is true of the value a build inlines and not of this process's own
  // environment: the arm under test is exactly the one only a test can move.
  const env = process.env as Record<string, string | undefined>;

  /** One boot under `nodeEnv` with the switch reading `value`, then each step, counting the listings asked after each. */
  async function bootAndStep(nodeEnv: string, value: string | undefined, steps: readonly number[]): Promise<number[]> {
    const before = env.NODE_ENV;
    env.NODE_ENV = nodeEnv;
    sweepSwitch = value;
    mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
    const counted: number[] = [];
    try {
      await register();
      for (const step of steps) {
        mock.timers.tick(step);
        await new Promise((resolve) => setImmediate(resolve));
        counted.push(apiCalls().filter(({ endpoint }) => endpoint === LISTE).length);
      }
    } finally {
      mock.timers.reset();
      if (before === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = before;
    }

    return counted;
  }

  it("waits its minute after a production boot reading on, then runs hourly", async () => {
    const steps = [MINUTE_MS - SEKUNDE_MS, SEKUNDE_MS, HOUR_MS - MINUTE_MS - SEKUNDE_MS, SEKUNDE_MS];

    assert.deepEqual(await bootAndStep("production", "on", steps), [0, 1, 1, 2]);
  });

  /* The default: a deploy is not a mailing, and the first armed pass asks about every fixture inside the window. */
  it("arms nothing where the switch is off", async () => {
    assert.deepEqual(await bootAndStep("production", "off", [3 * HOUR_MS]), [0]);
  });

  // A skipped validation leaves the value undefined, which a test negating "off" would arm on.
  it("arms nothing where the value is missing", async () => {
    assert.deepEqual(await bootAndStep("production", undefined, [3 * HOUR_MS]), [0]);
  });

  /* `next dev` reaches whatever backend the developer's own environment names, and mails from it. */
  it("arms nothing under a development build, whatever the switch says", async () => {
    assert.deepEqual(await bootAndStep("development", "on", [3 * HOUR_MS]), [0]);
  });
});

/* The stamp is what no local run can show, a stack that mails nothing filing every message. */
describe("which first requests the pass stamps", () => {
  /** One row per way a send ends, each to its own mailbox, and one referee booked. */
  function eineZeileJeAusgang(): void {
    ausgang.set("geliefert@schule.de", "accepted");
    ausgang.set("abgewiesen@schule.de", "refused");
    ausgang.set("zurueckgehalten@schule.de", "withheld");
    ausgang.set("gesperrt@schule.de", "barred");
    ausgang.set("ungewiss@schule.de", "lost");
    ausgang.set("schiri-zurueckgehalten@schule.de", "withheld");
    ausgang.set("schiri-gesperrt@schule.de", "barred");
    ausgang.set("schiri-abgewiesen@schule.de", "refused");
    ausgang.set("schiri-ungewiss@schule.de", "lost");
    passAnswer = (saisonId) => ({
      ...leererPass(saisonId),
      anfragen: [
        anfrage(1, "geliefert@schule.de"),
        anfrage(2, "abgewiesen@schule.de"),
        anfrage(3, "zurueckgehalten@schule.de"),
        anfrage(4, "gesperrt@schule.de"),
        anfrage(5, "ungewiss@schule.de"),
      ],
      einteilungen: [
        einteilung(6, "schiri@schule.de"),
        einteilung(7, "schiri-zurueckgehalten@schule.de"),
        einteilung(8, "schiri-gesperrt@schule.de"),
        einteilung(9, "schiri-abgewiesen@schule.de"),
        einteilung(10, "schiri-ungewiss@schule.de"),
      ],
    });
  }

  /* Production waits for a real send, withheld there being a missing key. A send whose answer was lost may have
     gone, and its fresh token is never sent again. */
  it("stamps on production only the rows whose message went or was kept from a barred address", async () => {
    eineZeileJeAusgang();

    await runSpielSweep();

    assert.deepEqual(gestempelt(), [id(1), id(4), id(6), id(8)]);
  });

  /* A stack that mails nothing would otherwise file every request hourly and never stamp one. */
  it("stamps off production a request the deployment filed, as well as one that went", async () => {
    appEnv = "local";
    eineZeileJeAusgang();

    await runSpielSweep();

    assert.deepEqual(gestempelt(), [id(1), id(3), id(4), id(6), id(7), id(8)]);
  });

  /* Mail, then stamp: a stamp before the send would leave a team that was never asked running to its deadline. */
  it("stamps after every request has been mailed, and never a reminder, which the pass stamped itself", async () => {
    passAnswer = (saisonId) => ({
      ...leererPass(saisonId),
      anfragen: [anfrage(1, "a@schule.de"), anfrage(2, "b@schule.de")],
      erinnerungen: [anfrage(3, "c@schule.de")],
    });

    await runSpielSweep();

    const stempel = ereignisse.findIndex((ereignis) => ereignis.art === "api" && ereignis.endpoint === ANGEFRAGT("2627"));
    const letzteMail = ereignisse.findLastIndex((ereignis) => ereignis.art === "mail");
    assert.ok(stempel > letzteMail, "the pass stamped before its last message went");
    assert.deepEqual(gestempelt(), [id(1), id(2)]);
    assert.equal(gesendet().length, 3, "the reminder was not mailed");
  });

  /* The referee's lane is no fan-out, so its failure is this pass's own line, and an address in it would be a person
     written to the log. */
  it("files a booking that was refused or lost its answer as one failure line each, naming no address", async () => {
    ausgang.set("schiri-abgewiesen@schule.de", "refused");
    ausgang.set("schiri-ungewiss@schule.de", "lost");
    passAnswer = (saisonId) => ({
      ...leererPass(saisonId),
      einteilungen: [einteilung(1, "schiri-abgewiesen@schule.de"), einteilung(2, "schiri-ungewiss@schule.de")],
    });

    await runSpielSweep();

    const spielleitung = { error_code: "FE-MAIL-002", operation: "spielbestaetigungSweep" };
    assert.deepEqual(
      passLines().filter(({ level }) => level === "error"),
      [
        { level: "error", event: "spielbestaetigung.spielleitung_failed", fields: { ...spielleitung, name: "MailSendError" } },
        { level: "error", event: "spielbestaetigung.spielleitung_failed", fields: { ...spielleitung, name: "APINetworkError" } },
      ],
    );
  });

  /* A row holding several links counts as asked once ANY of them went, whichever went first: a team whose second
     mailbox bounced was still asked. */
  it("stamps a row of two links where either went, and none where neither did", async () => {
    ausgang.set("abgewiesen@schule.de", "refused");
    passAnswer = (saisonId) => ({
      ...leererPass(saisonId),
      anfragen: [
        zweiLinks(1, "erste@schule.de", "abgewiesen@schule.de"),
        zweiLinks(2, "abgewiesen@schule.de", "zweite@schule.de"),
        zweiLinks(3, "abgewiesen@schule.de", "abgewiesen@schule.de"),
      ],
    });

    await runSpielSweep();

    assert.deepEqual(gestempelt(), [id(1), id(2)]);
    assert.equal(gesendet().length, 6, "a link went unmailed once its row counted as asked");
  });

  /* The pass answers an unstamped referee's booking again each later day until the deadline: each is mailed and stamped
     as a first one, under that day's key, so the provider never folds one day's send into the last. */
  it("mails and stamps a booking a later day's pass answers again, under that day's key", async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-02T09:00:00Z") });
    passAnswer = (saisonId) => ({ ...leererPass(saisonId), einteilungen: [einteilung(1, "schiri@schule.de")] });

    await runSpielSweep();
    t.mock.timers.setTime(Date.parse("2026-11-03T09:00:00Z"));
    await runSpielSweep();

    const [erste, zweite] = gesendet();
    assert.deepEqual(
      gesendet().map(({ to }) => to),
      ["schiri@schule.de", "schiri@schule.de"],
      "the booking answered again was not mailed again",
    );
    assert.equal(zweite?.subject, erste?.subject, "the booking answered again went out in other words");
    assert.deepEqual(gestempelt(), [id(1), id(1)], "the booking answered again was not stamped");
    assert.ok(erste?.idempotencyKey !== undefined && erste.idempotencyKey !== zweite?.idempotencyKey, "both days' sends share a key");
  });

  it("asks for no stamp where no request counts as made", async () => {
    ausgang.set("a@schule.de", "refused");
    passAnswer = (saisonId) => ({ ...leererPass(saisonId), anfragen: [anfrage(1, "a@schule.de")] });

    await runSpielSweep();

    assert.deepEqual(
      apiCalls().map(({ endpoint }) => endpoint),
      [LISTE, PASS("2627")],
    );
  });
});

/* A mint or a close moves the verdict a public fixture card reads, and a call whose
   answer was lost may have done either where no count shows it (`docs/frontend/spec.md :: I741`). */
describe("the fixtures cache's drop", () => {
  const PASSES = [
    ["that asked nobody", () => undefined],
    [
      "that mailed requests",
      () => {
        passAnswer = (saisonId) => ({ ...leererPass(saisonId), anfragen: [anfrage(1, "a@schule.de")] });
      },
    ],
    [
      "whose season's call threw",
      () => {
        passAnswer = () => {
          throw new Error("the pass was refused");
        };
      },
    ],
    [
      "whose season listing failed",
      () => {
        listeAnswer = () => {
          throw new Error("the listing was refused");
        };
      },
    ],
  ] as const;

  for (const [was, vorbereiten] of PASSES) {
    it(`asks for spiele once, after the pass's last call, on a pass ${was}`, async () => {
      vorbereiten();

      await runSpielSweep();

      assert.deepEqual(
        drops().map(({ tags }) => tags),
        [["spiele"]],
      );
      assert.equal(ereignisse.at(-1)?.art, "drop", "a call or a message followed the drop");
    });
  }
});

describe("what one pass mails", () => {
  /* The void notice first: a mailbox that read a fresh request before it would take the void one for the newer. */
  it("tells the parties of a moved fixture before it mails a fresh request", async () => {
    passAnswer = (saisonId) => ({
      ...leererPass(saisonId),
      anfragen: [anfrage(1, "team@schule.de")],
      neue_ansetzungen: [
        {
          spielbestaetigung_id: id(2),
          spiel_id: id(500),
          team1_name: "Ernst-Reuter-Schule",
          team2_name: "Goethe-Gymnasium",
          alt: { datum: "2026-11-13", uhrzeit: "10:00:00" },
          empfaenger: [{ address: "team@schule.de", rollen: ["trainer", "ansprechperson"] }],
        },
      ],
      schiedsrichter_neue_ansetzungen: [
        {
          spielbestaetigung_id: id(3),
          spiel_id: id(500),
          team1_name: "Ernst-Reuter-Schule",
          team2_name: "Goethe-Gymnasium",
          alt: { datum: "2026-11-13", uhrzeit: "10:00:00" },
          address: "schiri@schule.de",
        },
      ],
    });

    await runSpielSweep();

    assert.deepEqual(
      gesendet().map(({ to, subject }) => [to, subject.split(":")[0]]),
      [
        ["team@schule.de", "Neu angesetzt"],
        ["schiri@schule.de", "Neu angesetzt"],
        ["team@schule.de", "Bitte bestätigen"],
      ],
    );
    const [team, schiri, frische] = gesendet();
    // The team's notice is recorded against the seats it covered, the referee's rides the lane no record holds.
    assert.deepEqual(team?.tags, { ziel: "spielbestaetigung", ziel_id: id(2), anlass: "neue_ansetzung", rollen: "trainer-ansprechperson" });
    assert.deepEqual(schiri?.tags, { spielleitung: "hinweis" });
    // Keyed where the body cannot change inside the provider's window, and never over a fresh token.
    assert.ok(team?.idempotencyKey !== undefined && schiri?.idempotencyKey !== undefined, "a link-free notice went unkeyed");
    assert.equal(frische?.idempotencyKey, undefined, "a request carrying a fresh token was keyed");
  });

  /* The deadline the row carries, never one reckoned from the fixture's day. */
  it("names the deadline the pass answered and the link the row's token makes, to the mailbox that holds it", async () => {
    passAnswer = (saisonId) => ({ ...leererPass(saisonId), anfragen: [anfrage(1, "team@schule.de")] });

    await runSpielSweep();

    const [nachricht] = gesendet();
    assert.equal(nachricht?.to, "team@schule.de");
    assert.ok(nachricht?.text.includes("Bitte antworte bis zum 10.11.2026."), "the request names another deadline");
    assert.ok(!nachricht?.text.includes("13.11.2026"), "the request names a deadline it reckoned");
    assert.ok(nachricht?.text.includes("http://localhost:3000/bestaetigung/spiel?token=token-1"), "the request carries another link");
    assert.ok(nachricht?.text.includes("Bitte bestätige den Termin für Goethe-Gymnasium"), "the request names another club as the reader's");
  });

  /* One link per person, as the pass groups them: a mirrored pair is one message whose tag names both seats, so a
     bounce is recorded on each seat rather than on one or on neither. */
  it("mails a link held for two seats once, its tag naming both", async () => {
    passAnswer = (saisonId) => ({
      ...leererPass(saisonId),
      anfragen: [
        {
          ...anfrage(1, "trainer@schule.de"),
          links: [{ address: "trainer@schule.de", rollen: ["trainer", "stellvertretung"], token: "token-1" }],
        },
      ],
    });

    await runSpielSweep();

    assert.deepEqual(
      gesendet().map(({ to, tags }) => [to, tags]),
      [["trainer@schule.de", { ziel: "spielbestaetigung", ziel_id: id(1), anlass: "anfrage", rollen: "trainer-stellvertretung" }]],
    );
  });

  it("sends a referee's booking on the referee's lane, with no token", async () => {
    passAnswer = (saisonId) => ({ ...leererPass(saisonId), einteilungen: [einteilung(1, "schiri@schule.de")] });

    await runSpielSweep();

    const [nachricht] = gesendet();
    assert.deepEqual(nachricht?.tags, { spielleitung: "hinweis" });
    assert.ok(!nachricht?.text.includes("token="), "the booking carries a token");
  });

  /* The referee the close answered, on their own lane: their row is closed, so the request's stamp would mark nothing
     asked, and the notice's stamp is what keeps the next pass from telling them again. */
  it("tells a referee taken off a fixture on the referee's lane, and stamps it told rather than asked", async () => {
    passAnswer = (saisonId) => ({ ...leererPass(saisonId), schiedsrichter_gewechselt: [{ ...hinweis(4), address: "schiri@schule.de" }] });

    await runSpielSweep();

    assert.deepEqual(
      gesendet().map(({ to, subject, tags }) => [to, subject, tags]),
      [["schiri@schule.de", "Nicht mehr eingeteilt: Ernst-Reuter-Schule gegen Goethe-Gymnasium", { spielleitung: "hinweis" }]],
    );
    assert.ok(gesendet()[0]?.idempotencyKey !== undefined, "a link-free notice went unkeyed");
    assert.deepEqual([gestempelt(), mitgeteilt()], [[], [id(4)]]);
  });

  /* The league's call-off reaches everyone it asked, so no club and no referee who agreed travels to the ground. */
  it("tells the clubs' mailboxes and the referee of a called-off fixture, each notice keyed and stamped", async () => {
    passAnswer = (saisonId) => ({
      ...leererPass(saisonId),
      spiel_abgesagt: [{ ...hinweis(5), empfaenger: [{ address: "team@schule.de", rollen: ["trainer"] }] }],
      schiedsrichter_spiel_abgesagt: [{ ...hinweis(6), address: "schiri@schule.de" }],
    });

    await runSpielSweep();

    assert.deepEqual(
      gesendet().map(({ to, subject, tags }) => [to, subject, tags]),
      [
        [
          "team@schule.de",
          "Abgesagt: Ernst-Reuter-Schule gegen Goethe-Gymnasium am 13.11.2026",
          { ziel: "spielbestaetigung", ziel_id: id(5), anlass: "spiel_abgesagt", rollen: "trainer" },
        ],
        ["schiri@schule.de", "Abgesagt: Ernst-Reuter-Schule gegen Goethe-Gymnasium am 13.11.2026", { spielleitung: "hinweis" }],
      ],
    );
    assert.ok(
      gesendet().every(({ idempotencyKey }) => idempotencyKey !== undefined),
      "a link-free notice went unkeyed",
    );
    assert.deepEqual(mitgeteilt(), [id(5), id(6)]);
    // Stamped after both went: stamped first, a crash between would leave a party told by nobody and owed nothing.
    assert.deepEqual(
      ereignisse.map((ereignis) => (ereignis.art === "api" ? ereignis.endpoint : ereignis.art === "mail" ? ereignis.mail.to : "drop")),
      [LISTE, PASS("2627"), "team@schule.de", "schiri@schule.de", MITGETEILT("2627"), "drop"],
    );
  });

  /* Its decline said the league decides; this is the word that it has, which nothing else sends. */
  it("tells a club whose proposal was discarded that the date stands, keyed and stamped", async () => {
    passAnswer = (saisonId) => ({
      ...leererPass(saisonId),
      vorschlag_verworfen: [{ ...hinweis(7), empfaenger: [{ address: "team@schule.de", rollen: ["trainer", "stellvertretung"] }] }],
    });

    await runSpielSweep();

    assert.deepEqual(
      gesendet().map(({ to, subject, tags }) => [to, subject, tags]),
      [
        [
          "team@schule.de",
          "Termin bleibt: Ernst-Reuter-Schule gegen Goethe-Gymnasium am 13.11.2026",
          { ziel: "spielbestaetigung", ziel_id: id(7), anlass: "vorschlag_verworfen", rollen: "trainer-stellvertretung" },
        ],
      ],
    );
    assert.ok(gesendet()[0]?.idempotencyKey !== undefined, "the notice went unkeyed");
    assert.deepEqual(mitgeteilt(), [id(7)]);
  });

  /* Unstamped, the backend answers the notice again on the next pass; stamped though it never went, nobody would hear. */
  it("stamps a notice once a mailbox's send went, and none whose every send failed", async () => {
    ausgang.set("weg@schule.de", "refused");
    ausgang.set("schiri-weg@schule.de", "lost");
    passAnswer = (saisonId) => ({
      ...leererPass(saisonId),
      neue_ansetzungen: [
        {
          ...hinweis(7),
          empfaenger: [
            { address: "weg@schule.de", rollen: ["trainer"] },
            { address: "da@schule.de", rollen: ["ansprechperson"] },
          ],
        },
        { ...hinweis(8), empfaenger: [{ address: "weg@schule.de", rollen: ["trainer"] }] },
        // The mailbox that went ahead of the one that failed: neither the first send nor the last decides alone.
        {
          ...hinweis(10),
          empfaenger: [
            { address: "da@schule.de", rollen: ["ansprechperson"] },
            { address: "weg@schule.de", rollen: ["trainer"] },
          ],
        },
      ],
      schiedsrichter_spiel_abgesagt: [{ ...hinweis(9), address: "schiri-weg@schule.de" }],
    });

    await runSpielSweep();

    assert.deepEqual(mitgeteilt(), [id(7), id(10)]);
  });

  /* The pass call stamped the reminder before answering, so a pass ending at the notices' stamp would cost the season
     its reminders for good and its requests for an hour. */
  it("mails the reminders and requests and stamps the requests where the notices' stamp failed, filing that failure", async () => {
    mitgeteiltScheitert = true;
    passAnswer = (saisonId) => ({
      ...leererPass(saisonId),
      schiedsrichter_gewechselt: [{ ...hinweis(4), address: "schiri@schule.de" }],
      erinnerungen: [anfrage(2, "erinnert@schule.de")],
      anfragen: [anfrage(3, "neu@schule.de")],
    });

    await runSpielSweep();

    assert.deepEqual(
      gesendet().map(({ to }) => to),
      ["schiri@schule.de", "erinnert@schule.de", "neu@schule.de"],
    );
    assert.deepEqual(gestempelt(), [id(3)]);
    assert.deepEqual(passLines()[0], {
      level: "error",
      event: "spielbestaetigung.sweep_failed",
      fields: { error_code: "FE-SWEEP-004", name: "Error", saison_id: "2627" },
    });
  });

  /* Never in parallel: a fan-out would put every season's mail on the transport at once. */
  it("visits the seasons one at a time, in the order listed", async () => {
    listeAnswer = () => ({ acknowledged: 1, saison_ids: ["2627", "2728"], spiel_sweep_gelaufen_am: null });
    passAnswer = (saisonId) => ({ ...leererPass(saisonId), anfragen: [anfrage(saisonId === "2627" ? 1 : 2, `${saisonId}@schule.de`)] });

    await runSpielSweep();

    assert.deepEqual(
      ereignisse.map((ereignis) => (ereignis.art === "api" ? ereignis.endpoint : ereignis.art === "mail" ? ereignis.mail.to : "drop")),
      [LISTE, PASS("2627"), "2627@schule.de", ANGEFRAGT("2627"), PASS("2728"), "2728@schule.de", ANGEFRAGT("2728"), "drop"],
    );
  });
});

describe("the pass's lines", () => {
  /* Counts, never a person, an address or a token. */
  it("writes one line holding its counts", async () => {
    passAnswer = (saisonId) => ({
      ...leererPass(saisonId),
      anfragen: [anfrage(1, "a@schule.de")],
      erinnerungen: [anfrage(2, "b@schule.de")],
      geschlossen: 2,
    });

    await runSpielSweep();

    assert.deepEqual(passLines(), [
      {
        level: "info",
        event: "spielbestaetigung.sweep_pass",
        fields: { geschlossen: 2, angefragt: 1, erinnert: 1, mitgeteilt: 0, aufgegeben: 0, fehlgeschlagen: 0 },
      },
    ]);
  });

  /* Each pass moves on past a row it passed over, so only this count tells a pass failing on every row from a healthy one. */
  it("warns where the pass passed rows over", async () => {
    passAnswer = (saisonId) => ({ ...leererPass(saisonId), fehlgeschlagen: 3 });

    await runSpielSweep();

    assert.deepEqual(passLines(), [
      {
        level: "warn",
        event: "spielbestaetigung.sweep_pass",
        fields: { error_code: "FE-SWEEP-004", geschlossen: 0, angefragt: 0, erinnert: 0, mitgeteilt: 0, aufgegeben: 0, fehlgeschlagen: 3 },
      },
    ]);
  });

  /* A notice given up is a party nobody told: its line names the fixture an operator opens to tell them by hand
     (`docs/ops/runbooks.md` §9), and its stamp keeps the next pass from answering it again. */
  it("warns of each notice given up by its fixture and party, never a person, and stamps it", async () => {
    const aufgegeben = [
      { spielbestaetigung_id: id(11), spiel_id: id(500), partei: "team" as const },
      { spielbestaetigung_id: id(12), spiel_id: id(501), partei: "schiedsrichter" as const },
    ];
    passAnswer = (saisonId) => ({ ...leererPass(saisonId), mitteilungen_aufgegeben: aufgegeben });

    await runSpielSweep();

    assert.deepEqual(passLines(), [
      ...aufgegeben.map((notice) => ({
        level: "warn",
        event: "spielbestaetigung.mitteilung_aufgegeben",
        fields: { error_code: "FE-SWEEP-004", saison_id: "2627", ...notice },
      })),
      {
        level: "warn",
        event: "spielbestaetigung.sweep_pass",
        fields: { error_code: "FE-SWEEP-004", geschlossen: 0, angefragt: 0, erinnert: 0, mitgeteilt: 2, aufgegeben: 2, fehlgeschlagen: 0 },
      },
    ]);
    assert.deepEqual(mitgeteilt(), [id(11), id(12)]);
  });

  it("files a season it could not sweep under its own code, and goes on to the next", async () => {
    listeAnswer = () => ({ acknowledged: 1, saison_ids: ["2627", "2728"], spiel_sweep_gelaufen_am: null });
    passAnswer = (saisonId) => {
      if (saisonId === "2627") throw new Error("the pass was refused");
      return leererPass(saisonId);
    };

    await runSpielSweep();

    assert.deepEqual(passLines()[0], {
      level: "error",
      event: "spielbestaetigung.sweep_failed",
      fields: { error_code: "FE-SWEEP-004", name: "Error", saison_id: "2627" },
    });
    assert.ok(
      apiCalls().some(({ endpoint }) => endpoint === PASS("2728")),
      "the season after the failing one was not swept",
    );
  });

  /* A pass slower than the hour would otherwise mail beside itself before either reached its stamp. */
  it("skips a tick that finds the previous pass still running, with one line and no call", async () => {
    const gehalten: (() => void)[] = [];
    listeAnswer = () =>
      new Promise((resolve) => void gehalten.push(() => resolve({ acknowledged: 1, saison_ids: [], spiel_sweep_gelaufen_am: null })));

    const laufend = runSpielSweep();
    await runSpielSweep();
    for (const freigeben of gehalten) freigeben();
    await laufend;

    assert.equal(apiCalls().length, 1, "the second tick called the backend beside the running pass");
    assert.deepEqual(
      passLines().map(({ level, event }) => `${level} ${event}`),
      ["info spielbestaetigung.sweep_skipped", "info spielbestaetigung.sweep_pass"],
    );
  });
});
