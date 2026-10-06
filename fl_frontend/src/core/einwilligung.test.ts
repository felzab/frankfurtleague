import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { beginRenderPass, itOpensAScopeThatMemoizes, serveServerReactTo } from "@/core/cacheScope.ts";
import { einwilligungAnswer, publishedFassung, publishedLaufendeFassung, readEinwilligungDocument } from "@/core/einwilligungDocument.ts";
import { APIBadStatusError, APIMalformedDataError } from "@/core/errors.ts";
import { registerDoubles } from "@/core/exportingModule.ts";

import {
  gekeyteFassung,
  KONTAKT_ABSATZ_SCHLUESSEL,
  KONTAKT_BEDIEN_SCHLUESSEL,
  SCHIEDSRICHTER_ABSATZ_SCHLUESSEL,
  SPIELER_ABSATZ_SCHLUESSEL,
  SPIELER_WIEDERKEHREND_ABSATZ_SCHLUESSEL,
} from "./einwilligungSeiten.ts";

import type { FLEinwilligungFassung } from "./schemas.ts";

/** What the backend answers one call; the registry's own answer unless a case names another. */
type Answer = (endpoint: string) => Promise<unknown>;
const registry: Answer = (endpoint) => Promise.resolve(einwilligungAnswer(endpoint));
let answering: Answer = registry;

/** Every endpoint the client was asked for in this case, in order. */
const calls: string[] = [];
/** Every lifetime a cached read declared in this case, in order. */
const lifetimes: unknown[] = [];

beforeEach(() => {
  answering = registry;
  calls.length = 0;
  lifetimes.length = 0;
});

const inert = (): undefined => undefined;

// The client replaced at its module, each answer passed through the caller's schema as a real response
// is; `next/cache` answered inert, so the cached read's own declarations run outside a Next build.
registerDoubles({
  modules: {
    "core/api.ts": {
      apiClient: async (endpoint: string, schema: { parse: (value: unknown) => unknown }) => {
        calls.push(endpoint);
        return schema.parse(await answering(endpoint));
      },
    },
  },
  specifiers: { "next/cache": { cacheLife: (profile: unknown) => void lifetimes.push(profile), cacheTag: inert } },
});

const api = { calls: calls, answerWith: (next: Answer) => void (answering = next) };

serveServerReactTo((parentURL) => parentURL.startsWith(`${pathToFileURL(import.meta.dirname).href}/`));

const { getEinwilligungFassung, getLaufendeFassung, getLaufendesLabel, istFassungBekannt } = await import("./einwilligung.ts");

const DOCUMENT = readEinwilligungDocument();
const BEWERBUNG = publishedLaufendeFassung("bewerbung", DOCUMENT);
const KONTAKT = publishedLaufendeFassung("bestaetigung_kontakt", DOCUMENT);
/** The two contact pages beside the applicant's: a seat the administration filled, and one on a team's season row. */
const KONTAKT_VERWALTUNG = publishedLaufendeFassung("bestaetigung_kontakt_verwaltung", DOCUMENT);
const KONTAKT_SAISON = publishedLaufendeFassung("bestaetigung_kontakt_saison", DOCUMENT);
/** Every contact page's running label, which the link's view picks among. */
const KONTAKTSEITEN = [KONTAKT, KONTAKT_VERWALTUNG, KONTAKT_SAISON];
const SPIELER = publishedLaufendeFassung("bestaetigung_spieler", DOCUMENT);
/** The pupil page a returning pupil's link opens, which asks no choice. */
const SPIELER_WIEDERKEHREND = publishedLaufendeFassung("bestaetigung_spieler_wiederkehrend", DOCUMENT);
const SCHIEDSRICHTER = publishedLaufendeFassung("bestaetigung_schiedsrichter", DOCUMENT);
const UMFANG = ["kader_oeffentlich", "intern"] as const;

/** A page's keyed words, which every case on the two consent pages reads by name. */
const gekeyt = (fassung: FLEinwilligungFassung) =>
  gekeyteFassung(fassung, fassung === SPIELER ? SPIELER_ABSATZ_SCHLUESSEL : SCHIEDSRICHTER_ABSATZ_SCHLUESSEL, UMFANG);

const failure = (statusCode: number, serverErrorCode: string | undefined): APIBadStatusError =>
  new APIBadStatusError({
    message: "refused",
    url: "http://backend/api/v0/einwilligung/fassungen/x",
    statusCode: statusCode,
    serverErrorCode: serverErrorCode,
    endpoint: "/einwilligung/fassungen/x",
    method: "GET",
    readOnly: true,
    traceId: "0",
  });

describe("the words read", () => {
  it("answers a stored label with that label's own words, asked for by the label alone", async () => {
    const fassung = await getEinwilligungFassung("2026-09-spielerseite-2");

    assert.deepEqual(fassung, publishedFassung("2026-09-spielerseite-2", DOCUMENT));
    assert.deepEqual(api.calls, ["/einwilligung/fassungen/2026-09-spielerseite-2"]);
  });

  // A label read off a stored record is data, so one carrying a separator must not address another path.
  it("sends a label as one path segment whatever it holds", async () => {
    await getEinwilligungFassung("2026/../seiten");

    assert.deepEqual(api.calls, ["/einwilligung/fassungen/2026%2F..%2Fseiten"]);
  });

  /* The failure this registry exists to prevent: the running words under an old label are a record
     claiming a text its person never read, so an unknown label answers nothing at all. */
  it("answers nothing for a label the backend's registry does not hold", async () => {
    for (const unbekannt of ["2026-07", "toString", "constructor", "2026-09"]) {
      assert.equal(await getEinwilligungFassung(unbekannt), null, `"${unbekannt}" resolves to a wording nobody was shown`);
    }
  });

  /* What an admin editor marks beside a stored label: a key the registry holds nothing for is a record
     citing words nobody can produce, and a record citing none is worded by the editor itself. */
  it("tells a stored label the registry holds from one it does not, and asks nothing for a record citing none", async () => {
    assert.equal(await istFassungBekannt("2026-09-bestaetigung-3"), true);
    assert.equal(await istFassungBekannt("liga-2019-01-erfunden"), false);
    assert.equal(await istFassungBekannt(null), true);
    assert.deepEqual(api.calls, ["/einwilligung/fassungen/2026-09-bestaetigung-3", "/einwilligung/fassungen/liga-2019-01-erfunden"]);
  });

  it("keeps a label's words, and a label the registry does not hold, at the longest life", async () => {
    await getEinwilligungFassung("2026-09-spielerseite-2");
    await getEinwilligungFassung("2026-07");

    assert.deepEqual(lifetimes, ["max", "max"]);
  });

  /* Answered inside the cached scope and thrown outside it: a production build redacts a cached
     function's throw to a digest, which every page would read as a failed read. */
  it("throws words off their schema as a contract break, kept only briefly", async () => {
    const malformed = new APIMalformedDataError({
      message: "API returned malformed data.",
      url: "http://backend/api/v0/einwilligung/fassungen/x",
      statusCode: 200,
      endpoint: "/einwilligung/fassungen/x",
      method: "GET",
      readOnly: true,
      traceId: "0",
    });
    api.answerWith(() => Promise.reject(malformed));

    await assert.rejects(getEinwilligungFassung("2026-09-spielerseite-3"), { name: "ContractBreakError", message: /2026-09-spielerseite-3/ });
    assert.deepEqual(lifetimes, ["seconds"], "a malformed answer is kept as long as words are, or declared twice");
  });

  // Only the record-missing code is an unknown label: a 404 carrying none is a route nothing served.
  it("throws every other failure rather than calling the label unknown", async () => {
    for (const thrown of [failure(404, undefined), failure(500, "SYS-001")]) {
      api.answerWith(() => Promise.reject(thrown));

      await assert.rejects(getEinwilligungFassung("2026-09-spielerseite-3"), (error) => error === thrown);
    }
  });
});

describe("the running label", () => {
  /* First, so a scope that failed to take fails here rather than under the count below. */
  itOpensAScopeThatMemoizes();

  /* A deploy moves a page's running label: a frontend recreated before the backend would otherwise go
     on stamping a label the backend has moved past, and every confirmation would be refused. */
  it("is read once per render pass and again in the next one", async () => {
    beginRenderPass();
    await getLaufendesLabel("bestaetigung_kontakt");
    await getLaufendesLabel("bewerbung");

    beginRenderPass();
    await getLaufendesLabel("bestaetigung_kontakt");

    assert.deepEqual(api.calls, ["/einwilligung/seiten", "/einwilligung/seiten"]);
  });

  it("answers each page the label the backend runs there, and that label's words", async () => {
    beginRenderPass();

    for (const [seite, fassung] of [
      ["bewerbung", BEWERBUNG],
      ["bestaetigung_kontakt", KONTAKT],
      ["bestaetigung_kontakt_verwaltung", KONTAKT_VERWALTUNG],
      ["bestaetigung_kontakt_saison", KONTAKT_SAISON],
      ["bestaetigung_spieler", SPIELER],
      ["bestaetigung_spieler_wiederkehrend", SPIELER_WIEDERKEHREND],
      ["bestaetigung_schiedsrichter", SCHIEDSRICHTER],
    ] as const) {
      assert.equal(await getLaufendesLabel(seite), DOCUMENT.laufende_fassungen[seite]);
      assert.deepEqual(await getLaufendeFassung(seite), fassung);
    }
  });

  it("throws for a page the backend runs no label on, rather than stamping one of its own", async () => {
    beginRenderPass();
    api.answerWith(() => Promise.resolve({ acknowledged: 1, laufende_fassungen: { bewerbung: BEWERBUNG.text_version } }));

    await assert.rejects(getLaufendesLabel("bestaetigung_kontakt"), {
      name: "ContractBreakError",
      message: /runs no label for the page bestaetigung_kontakt/,
    });
  });

  /* Thrown as a contract break, which every page's degraded catch hands to the error boundary. */
  it("throws for a running label the backend serves no words for", async () => {
    beginRenderPass();
    api.answerWith((endpoint) =>
      endpoint === "/einwilligung/seiten"
        ? Promise.resolve({ acknowledged: 1, laufende_fassungen: { bewerbung: "2026-01-nirgends" } })
        : Promise.resolve(einwilligungAnswer(endpoint)),
    );

    await assert.rejects(getLaufendeFassung("bewerbung"), { name: "ContractBreakError", message: /runs 2026-01-nirgends on bewerbung/ });
  });
});

describe("a page's keyed words", () => {
  /* The page places its sections BY KEY, the label freezes them BY POSITION: each running label's map
     must hold exactly the page's keys, in the order and with the words its frozen array holds. */
  it("keys each page's running words under exactly that page's keys, in the frozen order", () => {
    for (const [fassung, schluessel, bedien] of [
      ...KONTAKTSEITEN.map((kontakt) => [kontakt, KONTAKT_ABSATZ_SCHLUESSEL, KONTAKT_BEDIEN_SCHLUESSEL] as const),
      [SPIELER, SPIELER_ABSATZ_SCHLUESSEL, UMFANG] as const,
      [SPIELER_WIEDERKEHREND, SPIELER_WIEDERKEHREND_ABSATZ_SCHLUESSEL, UMFANG] as const,
      [SCHIEDSRICHTER, SCHIEDSRICHTER_ABSATZ_SCHLUESSEL, UMFANG] as const,
    ]) {
      const { absaetze } = gekeyteFassung(fassung, schluessel, bedien);

      assert.deepEqual(
        Object.keys(fassung.absaetze_nach_schluessel ?? {}),
        [...schluessel],
        `${fassung.text_version} is keyed in another order`,
      );
      assert.deepEqual(Object.values(absaetze), fassung.absaetze, `${fassung.text_version}'s keyed words and its frozen array differ`);
    }
  });

  it("refuses a map missing one of the page's keys, or holding one more", () => {
    const { worum: _fehlt, ...ohneWorum } = KONTAKT.absaetze_nach_schluessel ?? {};

    // The control keys passed whole, so a throw here is the paragraph map's alone.
    assert.throws(() =>
      gekeyteFassung({ ...KONTAKT, absaetze_nach_schluessel: ohneWorum }, KONTAKT_ABSATZ_SCHLUESSEL, KONTAKT_BEDIEN_SCHLUESSEL),
    );
    assert.throws(() =>
      gekeyteFassung(
        { ...KONTAKT, absaetze_nach_schluessel: { ...KONTAKT.absaetze_nach_schluessel, mehr: "x" } },
        KONTAKT_ABSATZ_SCHLUESSEL,
        KONTAKT_BEDIEN_SCHLUESSEL,
      ),
    );
  });

  // An earlier label's keys were never kept, and another page's are not this page's.
  it("refuses a label whose keys were never kept, and another page's label", () => {
    assert.throws(() => gekeyteFassung(publishedFassung("2026-09-spielerseite-2", DOCUMENT), SPIELER_ABSATZ_SCHLUESSEL));
    assert.throws(() => gekeyteFassung(SCHIEDSRICHTER, SPIELER_ABSATZ_SCHLUESSEL));
  });

  /* A control whose words sit outside the frozen wording is a question a record cannot reproduce
     beside the answer it holds, which is what every consent page here exists to make possible. */
  it("carries every control label of the two pages that ask a second question", () => {
    // Both ask the publication question with the same two chips, keyed by the `umfang` each writes.
    const spieler = gekeyt(SPIELER);
    const schiedsrichter = gekeyt(SCHIEDSRICHTER);

    assert.notEqual(
      spieler.bedienelemente.intern,
      schiedsrichter.bedienelemente.intern,
      "one page's chip answers the other's page, where the two say different things about a name",
    );
  });
});

describe("the wording the backend runs", () => {
  /* Nothing pins WHICH label is live but these cases: an earlier label states the fourteen days with
     no start, or with no carve-out for the reminder. */
  // The season row's page is no application's, so it states its link's own fourteen days instead.
  it("points every live label of an application's contacts at a wording naming when the fourteen days start and what does not restart them", () => {
    for (const { text_version, absaetze } of [BEWERBUNG, KONTAKT, KONTAKT_VERWALTUNG]) {
      const text = absaetze.join(" ");

      assert.ok(text.includes("dem Versand"), `${text_version} states the deadline without naming the day it starts`);
      assert.ok(text.includes("eine Erinnerung verschiebt sie nicht"), `${text_version} lets a reminder read as a new deadline`);
    }
  });

  /* Its own case rather than a third entry in the array above: a registration's deadline is seven
     days from the mail with no re-send, so that case's two sentences are false of this page. */
  it("points both live pupil labels at a wording naming the seven days a registration has", () => {
    for (const { text_version, absaetze } of [SPIELER, SPIELER_WIEDERKEHREND]) {
      assert.ok(absaetze.join(" ").includes("sieben Tagen"), `${text_version} states no deadline a pupil can count`);
    }
  });

  /* The three other periods read as exhausting the outcomes, so a reader whose own confirmation
     produced the fourth is shown three periods and told nothing about theirs. */
  it("points the live confirmation label at a wording naming the period for an application nobody decides", () => {
    const text = KONTAKT.absaetze.join(" ");

    assert.ok(text.includes("ohne Entscheidung"), `${KONTAKT.text_version} states no period for an undecided application`);
    assert.ok(text.includes("vorbei ist"), `${KONTAKT.text_version} names no day that period is counted to`);
  });

  /* The earlier labels rest participation on a contract a 16-year-old cannot enter alone, and offer
     the media switch from 16. */
  it("points every live confirmation label at legitimate interest, and at the media age", () => {
    for (const { text_version, absaetze } of [...KONTAKTSEITEN, SPIELER, SCHIEDSRICHTER]) {
      const text = absaetze.join(" ");

      assert.ok(text.includes("Art. 6 Abs. 1 lit. f DSGVO"), `${text_version} names no legitimate interest`);
      // Art. 13(1)(d) DSGVO asks for the interest itself, which the article's number does not name.
      assert.ok(text.includes("den Spielbetrieb der Liga durchzuführen"), `${text_version} names no interest the league pursues`);
      assert.ok(!text.includes("lit. b"), `${text_version} still rests something on a contract`);
      assert.ok(text.includes("besonderen Situation"), `${text_version} states the objection without its condition`);
    }
    for (const { text_version, absaetze } of [...KONTAKTSEITEN, SPIELER, SCHIEDSRICHTER]) {
      assert.ok(absaetze.join(" ").includes("ab {medienMinAlter} Jahren"), `${text_version} offers media consent at no stated age`);
    }
  });

  /* Art. 21(4) asks the objection to stand apart from every other piece of information, so a label
     folding it back into the rights paragraph states the right in a form the article refuses. */
  it("gives the objection a paragraph of its own on the two pages that ask a consent", () => {
    for (const fassung of [SPIELER, SCHIEDSRICHTER]) {
      const { absaetze } = gekeyt(fassung);

      assert.match(absaetze.art21, /^Der Verarbeitung .* \(Art\. 21 DSGVO\)\.$/, `${fassung.text_version} states no objection of its own`);
      assert.ok(!absaetze.widerruf.includes("Art. 21"), `${fassung.text_version} folds the objection into the rights paragraph`);
    }
  });

  /* The same article asks the same separation of a page whose confirmation is no consent. */
  it("gives the objection a paragraph of its own on every contact person's page", () => {
    for (const fassung of KONTAKTSEITEN) {
      const { absaetze } = gekeyteFassung(fassung, KONTAKT_ABSATZ_SCHLUESSEL, KONTAKT_BEDIEN_SCHLUESSEL);

      assert.match(
        absaetze.art21,
        /^Der Verarbeitung Deiner Daten .* \(Art\. 21 DSGVO\)\.$/,
        `${fassung.text_version} states no objection of its own`,
      );
      assert.ok(!absaetze.widerruf.includes("Art. 21"), `${fassung.text_version} folds the objection into the rights paragraph`);
    }
  });

  /* The form is the submitting Ansprechperson's first contact, so the same article asks the objection
     there, and a live label losing it sends that person to their own page first to learn of it. */
  it("points the live form label at a paragraph holding the objection and nothing else", () => {
    assert.deepEqual(
      BEWERBUNG.absaetze.filter((absatz) => absatz.includes("Art. 21")),
      [
        "Der Verarbeitung Deiner Angaben kannst Du jederzeit aus Gründen widersprechen, die sich aus Deiner besonderen Situation ergeben (Art. 21 DSGVO).",
      ],
      `${BEWERBUNG.text_version} states no objection of its own, or folds it into another paragraph`,
    );
  });

  /* A label dropping either offers a consent with no place, or promises more than the league keeps. */
  it("names where media is published, and what a younger person is spared", () => {
    for (const fassung of [SPIELER, SCHIEDSRICHTER]) {
      const { medien } = gekeyt(fassung).absaetze;

      assert.ok(medien.includes("auf unserer Website und unserem Instagram-Kanal"), `${fassung.text_version} names no place of publication`);
      assert.ok(
        medien.includes("keine Fotos oder Videos, auf denen Du zu erkennen bist"),
        `${fassung.text_version} drops the identifiability bound`,
      );
      assert.ok(medien.includes("keine Interviews mit Dir"), `${fassung.text_version} drops the interviews a younger person is spared`);
    }
  });

  /* A referee is kept until the entry is deleted for good, a retirement deleting nothing: „solange Du
     für die Liga Spiele leitest“ promises an end nobody enforces. The fee's word is every admin
     surface's and the glossary's. */
  it("keeps the referee label's retention rule and the league's word for the fee", () => {
    const { absaetze } = gekeyt(SCHIEDSRICHTER);
    const text = SCHIEDSRICHTER.absaetze.join(" ");

    assert.ok(absaetze.frist.includes("bis er endgültig gelöscht wird"), `${SCHIEDSRICHTER.text_version} states no retention rule`);
    assert.ok(
      absaetze.frist.includes("Setzt die Verwaltung Dich nur nicht mehr ein, bleibt er bestehen."),
      `${SCHIEDSRICHTER.text_version} lets a retirement read as a deletion`,
    );
    assert.ok(!text.includes("solange Du für die Liga Spiele leitest"), `${SCHIEDSRICHTER.text_version} promises an end nobody enforces`);
    assert.ok(text.includes("Honorar"), `${SCHIEDSRICHTER.text_version} names the fee in no word the league uses`);
    assert.ok(!text.includes("Aufwandsentschädigung"), `${SCHIEDSRICHTER.text_version} names the fee in a word no admin surface uses`);
  });

  /* The school is optional on a referee's record, so a basis calling it needed claims a necessity the
     record does not bear, in every record citing the label. */
  it("calls a referee's school needed only where the referee gives one", () => {
    assert.ok(
      gekeyt(SCHIEDSRICHTER).absaetze.rechtsgrundlage.includes("dazu Deine Schule, falls Du sie angibst"),
      `${SCHIEDSRICHTER.text_version} calls the school needed`,
    );
  });

  /* A referee's name is one field, shown as its first part and the next one's initial, or whole:
     „nie Dein voller Nachname“ breaks for a one-word name, and an entry may lack a telephone or a school. */
  it("promises the referee the name rule the fixtures keep, and holds nothing the entry may lack", () => {
    const { absaetze, bedienelemente } = gekeyt(SCHIEDSRICHTER);
    const text = SCHIEDSRICHTER.absaetze.join(" ");

    assert.ok(
      absaetze.veroeffentlichung.includes(
        "der erste Teil Deines Namens und vom nächsten nur der Anfangsbuchstabe; ist nur ein Name eingetragen, steht er ganz da.",
      ),
      `${SCHIEDSRICHTER.text_version} promises a name rule the fixtures do not keep`,
    );
    assert.ok(
      !`${text} ${Object.values(bedienelemente).join(" ")}`.includes("Nachname"),
      `${SCHIEDSRICHTER.text_version} promises a surname the row may not hold`,
    );
    assert.ok(
      absaetze.gespeichert.includes("und, falls angegeben, Deine Schule und Deine Telefonnummer"),
      `${SCHIEDSRICHTER.text_version} states an optional field as held`,
    );
  });

  /* „Zugang“ names an administration grant alone, so a live label saying it of the person's own account
     tells a pupil or a referee they hold one. */
  it("points the two consent pages' live labels at „Konto“ for the person's account, and never at „Zugang“", () => {
    for (const { text_version, absaetze } of [SPIELER, SCHIEDSRICHTER]) {
      const text = absaetze.join(" ");

      assert.ok(!text.includes("Zugang"), `${text_version} calls the person's account a grant`);
      assert.ok(text.includes("in Deinem Konto"), `${text_version} names no account the choices are changed in`);
    }
  });

  /* Records stamped under these two labels cite „Zugang“, so the rename is a new label: rewording
     them leaves a record claiming words its person never saw. */
  it("keeps each earlier consent label answering the „Zugang“ wording its records cite", () => {
    for (const textVersion of ["2026-09-spielerseite-2", "2026-09-schiedsrichterseite-2"]) {
      assert.ok(
        publishedFassung(textVersion, DOCUMENT).absaetze.join(" ").includes("Dein Zugang zur Website"),
        `${textVersion} answers words its records were not shown`,
      );
    }
  });

  it("keeps the retired wording retired: the old label answers the old words and no newer ones", () => {
    const alt = publishedFassung("2026-08", DOCUMENT);

    // The 2026-08 switch consented to a stored birthdate, and the confirmation wording asks each person
    // for their own, so one label may not answer the other's words.
    assert.ok(alt.absaetze.join(" ").includes("Geburtsdatum speichert"), "the retired wording lost the words that identify it");
    assert.ok(!BEWERBUNG.absaetze.join(" ").includes("Geburtsdatum speichert"), "the current wording answers under the old label");
    assert.notEqual(alt.schalter, BEWERBUNG.schalter, "both versions label the switch the same way");
  });

  /* The form's label is stamped on a record the applicant made and on one an administrator made, and
     neither of those readers saw a word of the confirmation page. */
  it("gives the confirmation page a label of its own, sharing no paragraph with the submitted one", () => {
    assert.notEqual(KONTAKT.text_version, BEWERBUNG.text_version, "both surfaces stamp one label");
    assert.deepEqual(
      KONTAKT.absaetze.filter((absatz) => BEWERBUNG.absaetze.includes(absatz)),
      [],
      "a paragraph answers under both labels, so one of the two records cites words nobody read",
    );
  });
});
