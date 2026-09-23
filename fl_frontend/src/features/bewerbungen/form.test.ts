import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, it, mock } from "node:test";

import { act, createElement as h } from "react";

import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { blankComments } from "@/core/blankComments";
import { doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { renderMarkup, renderTree, textOf } from "@/shared/testing/renderTest";
import { toFieldErrors } from "@/shared/utils/validation";

import { FLPostBewerbungPayloadSchema } from "./schemas.ts";

import type { BewerbungFormDraft } from "./types.ts";

type User = ReturnType<typeof userEvent.setup>;

/** Every request the form makes, answered by each case that sends one; unset, a request never returns. */
const fetchMock = mock.fn<(url: string, init?: RequestInit) => Promise<Response>>();

// The browser's own `fetch` rather than the transport's module: the form reaches both routes through it,
// so a request is observed at the edge the paths are limited at.
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => fetchMock(String(input), init)) as typeof fetch;

const { raised } = doubleToasts();

/** Every toast the press raised at one severity, as the reader meets it. */
const toastsOf = (variant: string) => raised.filter((toast) => toast.variant === variant).map((toast) => [toast.title, toast.description]);

beforeEach(() => {
  fetchMock.mock.resetCalls();
  fetchMock.mock.restore();
  raised.length = 0;
  fetchMock.mock.mockImplementation(() => new Promise<never>(() => undefined));
});

/*
 Every module below is reached AFTER both harnesses above have evaluated: the JSX compile step is
 registered, and the DOM installed, as each one does, and a static import resolves before either.
*/
const { Form } = await import("@heroui/react");
const { BewerbungForm } = await import("./components/forms/BewerbungForm/BewerbungForm.tsx");
const { BewerbungView } = await import("./components/views/BewerbungView.tsx");
const { BewerbungInstagramBand } = await import("./components/ui/BewerbungInstagramBand.tsx");
const { BEWERBUNG_BESTAETIGUNG_FRIST_TAGE, BEWERBUNG_SEATS } = await import("./constants.ts");
const { bewerbungPayload, buildEmptyBewerbungDraft, KUERZEL_UNGEPRUEFT } = await import("./utils.ts");
const { TRAINER_ZUGLEICH_OPTIONS, TRIKOT_FARBE_OPTIONS } = await import("@/features/teams/constants.ts");
const { FormSchuleSection } = await import("./components/forms/BewerbungForm/FormSchuleSection.tsx");
const { FormTeamSection } = await import("./components/forms/BewerbungForm/FormTeamSection.tsx");
const { FormEinwilligungSection } = await import("./components/forms/BewerbungForm/FormKontaktpersonenSection.tsx");
const { ergebnisPanel } = await import("./components/views/BestaetigungPanels.tsx");
const { FieldLabel } = await import("@/shared/components/ui/FieldLabel.tsx");
const { SCHULE_NICHT_IN_LISTE } = await import("./constants.ts");
const { buildEmptyBewerbungSchule } = await import("./utils.ts");
const { LIGA_KENNTNISNAHME } = await import("@/core/einwilligung.ts");
const { formPanel } = await import("@/shared/components/ui/formPanel.ts");
const { FIELD_ERROR, FIELD_ERROR_SWITCH } = await import("@/shared/components/ui/formFieldStyles.ts");

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..");

const read = (...parts: string[]): string => readFileSync(path.join(SRC_DIR, ...parts), "utf8");

const FORM = read("features", "bewerbungen", "components", "forms", "BewerbungForm", "BewerbungForm.tsx");
const PAGE = read("app", "(public)", "bewerbung", "[saison_id]", "page.tsx");

const SCHOOLS = [{ id: "68d0f2a4c1e2b3a4d5e6f708", name: "Lessing-Kolleg" }];

/** The form as the applicant meets it, composed by the component the page renders rather than here. */
const FORM_MARKUP = renderMarkup(BewerbungForm, { saisonId: "2026", schulen: SCHOOLS, isSchulenLesbar: true, vergebeneFarben: [] });

/** Everything the panel needs but the picked key, which is the one thing the two arms differ by. */
const SCHOOL_PROPS = {
  schulen: SCHOOLS,
  auswahl: SCHULE_NICHT_IN_LISTE,
  schule: buildEmptyBewerbungSchule(),
  stufengroesse: null,
  onAuswahlPicked: () => undefined,
  onSchuleChange: () => undefined,
  onStufengroesseChange: () => undefined,
  onFieldLeft: () => undefined,
  onSchulformPicked: () => undefined,
  onKuerzelLeft: () => undefined,
  kuerzelHinweis: null,
  isSchulenLesbar: true,
};

/**
 * The new-school arm, which the form above never reaches: it opens on the picker's sentinel, and a
 * fresh draft has picked nothing.
 */
const NEW_SCHOOL_MARKUP = renderMarkup(FormSchuleSection, SCHOOL_PROPS);

/**
 * The other arm, where the new-school block does not render. The arm above cannot tell the two
 * placements apart: everything the panel owns renders there, whichever side of the `istNeueSchule`
 * guard it sits on.
 */
const EXISTING_SCHOOL = renderMarkup(FormSchuleSection, { ...SCHOOL_PROPS, auswahl: SCHOOLS[0]!.id });

/** Every element a submitted value is read off, with the attributes that decide what it announces. */
function namedControls(html: string): { name: string; attrs: string }[] {
  return [...html.matchAll(/<(?:input|select|textarea)\b([^>]*)>/g)]
    .map((hit) => ({ attrs: hit[1] ?? "", name: /\bname="([^"]*)"/.exec(hit[1] ?? "")?.[1] ?? "" }))
    .filter((control) => control.name !== "");
}

/** Every switch, as the refusal has to find it: by the payload path its own checkbox carries. */
const switchesIn = (html: string): { name: string; attrs: string }[] =>
  [...html.matchAll(/<input\b([^>]*\brole="switch"[^>]*)>/g)].map((hit) => ({
    attrs: hit[1] ?? "",
    name: /\bname="([^"]*)"/.exec(hit[1] ?? "")?.[1] ?? "",
  }));

const person = (vorname: string, nachname: string, email: string, telefon: string) => ({
  vorname: vorname,
  nachname: nachname,
  email: email,
  telefon: telefon,
  einwilligung: { ...buildEmptyBewerbungDraft("2026").kontakte.trainer.einwilligung, erteilt: true },
});

/** An application the payload schema takes whole, for a school the league already holds. */
const COMPLETE_DRAFT: BewerbungFormDraft = {
  ...buildEmptyBewerbungDraft("2026"),
  auswahl: SCHOOLS[0]!.id,
  stufengroesse: 90,
  kontakte: {
    ansprechperson: person("Anna", "Meier", "anna@schule.example", "069 1111111"),
    stellvertretung: person("Bernd", "Kraus", "bernd@schule.example", "069 2222222"),
    trainer: person("Clara", "Wolf", "clara@schule.example", "069 3333333"),
    trainer_ist_zugleich: null,
  },
  trikot: { vorhandener_satz: "", wunschfarbe: TRIKOT_FARBE_OPTIONS[0]!.value },
  kader: { voraussichtliche_groesse: 14, gute_spieler: 3 },
};

/** The running page, which hands the form the strip it repeats under the receipt. */
function renderApplicationPage() {
  const user = userEvent.setup({ delay: null });
  const view = render(
    h(BewerbungView, {
      saisonId: "2026",
      isUnlesbar: false,
      today: "2026-04-01",
      schulen: SCHOOLS,
      isSchulenLesbar: true,
      vergebeneFarben: [],
      fenster: { acknowledged: 1, saison_id: "2026", offen: true, von: "2026-03-01", bis: "2026-04-30", laeuft: true },
    }),
  );

  return { user, container: view.container };
}

// By the path rather than by role and label: the three contact seats render one set of labels
// between them, and no rendered region names a seat for a query to scope itself by.
/** A control by the payload path it carries, which is also what every refusal lands on. */
const control = (container: HTMLElement, name: string): HTMLElement =>
  container.querySelector<HTMLElement>(`[name="${name}"]`) ?? assert.fail(`the form renders no control named ${name}`);

/** Entered as a reader enters it, and left where the case is about what leaving the box does. */
async function typeInto(user: User, box: HTMLElement, value: string, { leaveBox = false } = {}): Promise<void> {
  await user.clear(box);
  await user.paste(value);
  // A click on the page rather than a tab, which would land in the wish box and open its suggestions over the form.
  if (leaveBox) await user.click(document.body);
}

/** Every control the draft answers, through the control a reader would use for it. */
async function fillIn(user: User, container: HTMLElement, draft: BewerbungFormDraft): Promise<void> {
  await user.selectOptions(control(container, "team_id"), draft.auswahl ?? "");
  await typeInto(user, screen.getByRole("textbox", { name: "Größe der Stufe" }), String(draft.stufengroesse));

  for (const { value } of BEWERBUNG_SEATS) {
    for (const field of ["vorname", "nachname", "email", "telefon"] as const) {
      await typeInto(user, control(container, `kontakte.${value}.${field}`), draft.kontakte[value][field]);
    }
  }

  await user.click(switchLabel());
  await user.selectOptions(control(container, "trikot.wunschfarbe"), draft.trikot.wunschfarbe ?? "");
  await typeInto(user, screen.getByRole("textbox", { name: "Voraussichtliche Kadergröße" }), String(draft.kader.voraussichtliche_groesse));
  await typeInto(user, screen.getByRole("textbox", { name: "Davon im Verein aktiv (mind. Verbandsliga)" }), String(draft.kader.gute_spieler));
}

/** What every arm that may have landed tells the applicant, spelled here so a rewording fails a case. */
const BEWERBUNG_UNKLAR = "Schick die Bewerbung hier unverändert noch einmal ab: Doppelt ankommen kann sie so nicht.";

/** The requests the form made, by path and parsed body. */
const requestsMade = () =>
  fetchMock.mock.calls.map(({ arguments: [url, init] }) => ({ url, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined }));

/** A request's answer arriving, and everything it sets off. */
const settle = (): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

/** The page after a complete application was sent and the route took it, with the receipt it leaves. */
async function submitApplication() {
  fetchMock.mock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ success: true, message: "" }))));
  const mounted = renderApplicationPage();

  await fillIn(mounted.user, mounted.container, COMPLETE_DRAFT);
  await mounted.user.click(screen.getByRole("button", { name: "Bewerbung abschicken" }));
  await settle();

  const receipt =
    screen.queryByRole("status") ?? assert.fail(`the complete application left no receipt, the form refusing: ${refusalsShown().join(" | ")}`);

  return { ...mounted, receipt };
}

/** The running page with the picker on „meine Schule ist nicht dabei“, where the new school's boxes open. */
async function renderNewSchool() {
  const mounted = renderApplicationPage();
  await mounted.user.selectOptions(control(mounted.container, "team_id"), SCHULE_NICHT_IN_LISTE);

  return { ...mounted, kuerzel: screen.getByRole("textbox", { name: "Wunschkürzel" }) };
}

/** The Kenntnisnahme switch's label, which a person presses: the checkbox inside it is visually hidden. */
const switchLabel = (): HTMLElement => screen.getByRole("switch").closest("label") ?? assert.fail("the switch renders no label to press");

/** What the switch is described by, which is where its refusal reaches a reader. */
const switchSays = (): string =>
  (screen.getByRole("switch").getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");

/**
 * What every refusing field is announcing, as a reader meets it: a control publishes its refusal as
 * its own description, and `aria-invalid` is what parts that from the standing hints beside it.
 */
const refusalsShown = (): string[] =>
  (["textbox", "combobox", "switch", "spinbutton"] as const)
    .flatMap((role) => screen.queryAllByRole(role, { description: /./ }))
    .filter((control) => control.getAttribute("aria-invalid") === "true")
    .map((control) =>
      (control.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ")
        .trim(),
    );

/** Whether the browser would ask before leaving: a `beforeunload` some listener cancelled. */
const asksBeforeLeaving = (): boolean => !window.dispatchEvent(new Event("beforeunload", { cancelable: true }));

describe("the public application form", () => {
  /* First, because every source-text case below reads one of these: a path that stopped resolving
     would leave each of them matching against an empty string and reporting nothing. */
  it("finds each file it reads at all", () => {
    for (const [name, source] of [
      ["the form", FORM],
      ["the page", PAGE],
    ] as const) {
      assert.ok(source.length > 0, `${name} is empty, so this file proves nothing about it`);
    }
  });

  /* One composer, so the submit cannot assemble a second payload beside the one the blur-time judgements
     parse. `location = /api/bewerbung` is an EXACT nginx match: a path segment falls through to the
     unlimited catch-all. */
  it("posts the payload one composer built to the path the edge limits, and shows the send in flight", async () => {
    const { user, container } = renderApplicationPage();

    await fillIn(user, container, COMPLETE_DRAFT);
    await user.click(screen.getByRole("button", { name: "Bewerbung abschicken" }));

    assert.deepEqual(
      requestsMade(),
      [{ url: "/api/bewerbung", body: bewerbungPayload(COMPLETE_DRAFT) }],
      "the submit posts something other than the composed payload",
    );
    assert.ok(screen.queryByRole("button", { name: "Schickt ab..." }), "the send in flight is not shown on its button");
  });

  /* A commit whose answer was lost: the route's sentence is an administrator's reload-and-check, and
     the key makes the press it asks for a replay rather than a second application. */
  it("titles an application of unknown outcome as unclear, and asks for the same press again", async () => {
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: false, error: "Ob die Änderung gespeichert wurde, ist unklar.", outcome: "unknown" })),
      ),
    );
    const { user, container } = renderApplicationPage();

    await fillIn(user, container, COMPLETE_DRAFT);
    await user.click(screen.getByRole("button", { name: "Bewerbung abschicken" }));
    await settle();

    assert.deepEqual(toastsOf("danger"), [["Unklar, ob es bei uns angekommen ist", BEWERBUNG_UNKLAR]]);
  });

  /* The request may have reached the route before the connection broke: one next step for every arm
     that may have landed, never a bare retry beside the unknown outcome's replay. */
  it("gives an unread answer the unknown outcome's one step", async () => {
    fetchMock.mock.mockImplementation(() => Promise.reject(new TypeError("Failed to fetch")));
    const { user, container } = renderApplicationPage();

    await fillIn(user, container, COMPLETE_DRAFT);
    await user.click(screen.getByRole("button", { name: "Bewerbung abschicken" }));
    await settle();

    assert.deepEqual(toastsOf("danger"), [["Unklar, ob es bei uns angekommen ist", BEWERBUNG_UNKLAR]]);
  });

  /* The contact block's distinct-address rule refuses the block as a whole, a path no control spells:
     the answer's own sentence speaks, never the generic one, whose retry resends the refused body. */
  it("announces the sentence the answer brings for a refusal no box can take, under the form's own title", async () => {
    const EIGENER_SATZ = "Der Satz, den die Antwort für diesen Fall mitbringt.";
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ success: false, fieldErrors: { kontakte: "abgelehnt" }, unplacedError: EIGENER_SATZ }))),
    );
    const { user, container } = renderApplicationPage();
    assert.ok(container.querySelector('[name="kontakte"]') === null, "the case's path is one a control renders");

    await fillIn(user, container, COMPLETE_DRAFT);
    await user.click(screen.getByRole("button", { name: "Bewerbung abschicken" }));
    await settle();

    // One toast in all: a second beside the failure's would announce the press twice.
    assert.deepEqual(toastsOf("danger"), [["Bewerbung nicht abgeschickt", EIGENER_SATZ]]);
    assert.equal(raised.length, 1, "the press raised a second toast beside its one failure");
  });

  /* A repeated press whose details changed is refused, yet the first application stands: titled
     „nicht abgeschickt“, the toast would send the applicant to apply a second time. */
  it("titles the refusal of a repeated press as arrived, over the answer's own sentence", async () => {
    const SCHON_DA = "Deine Bewerbung ist schon angekommen.";
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ success: false, error: SCHON_DA, schonAngekommen: true }))),
    );
    const { user, container } = renderApplicationPage();

    await fillIn(user, container, COMPLETE_DRAFT);
    await user.click(screen.getByRole("button", { name: "Bewerbung abschicken" }));
    await settle();

    assert.deepEqual(toastsOf("danger"), [["Bewerbung schon angekommen", SCHON_DA]]);
  });

  /* A `limit_req` 429 is generated before either route handler runs, so it carries nginx's HTML and
     none of the always-200 envelope. Read as a transport failure it tells an applicant nothing about
     the one remedy it has, which is to wait. */
  it("answers the edge's rate limit in its own words on the availability check", async () => {
    fetchMock.mock.mockImplementation(() => Promise.resolve(new Response("<html>429</html>", { status: 429 })));
    const { user, kuerzel } = await renderNewSchool();

    await typeInto(user, kuerzel, "GG", { leaveBox: true });
    await settle();

    assert.deepEqual(toastsOf("warning"), [["Kürzel noch nicht geprüft", `Zu viele Anfragen in kurzer Zeit. ${KUERZEL_UNGEPRUEFT}`]]);
    // Read beside the render: a second spelling of the number behaves identically until the edge's own changes.
    assert.ok(!FORM.includes("= 429"), "the form spells the edge's status beside the one publicSubmit.ts exports");
  });

  /* The route's `length(2)` refuses an incomplete code, and the check is rate-limited per address at an
     EXACT nginx location: a half-typed box would spend requests, and a path segment escape the limit. */
  it("asks about a code only once it is the full width, at the path the edge limits", async () => {
    const { user, kuerzel } = await renderNewSchool();

    await typeInto(user, kuerzel, "G", { leaveBox: true });
    assert.deepEqual(requestsMade(), [], "the check fires on a code nobody finished typing");

    await typeInto(user, kuerzel, "gg", { leaveBox: true });
    assert.deepEqual(
      requestsMade().map(({ url }) => url),
      ["/api/bewerbung/kuerzel?shorthand=GG"],
      "a full-width code is checked at a path the edge does not limit",
    );
  });

  /* A ratified decision (`.claude/rules/frontend.md`): a typed field is judged when it is LEFT. A
     message between two keystrokes describes a value nobody finished entering. */
  it("judges a typed field on blur and a picked one on the press", async () => {
    const { user, container } = renderApplicationPage();
    const refusedSentence = "Ohne diese Kenntnisnahme können wir die Bewerbung nicht annehmen.";

    await user.type(control(container, "kontakte.ansprechperson.email"), "anna@");
    assert.deepEqual(refusalsShown(), [], "a seat's field is judged between keystrokes");

    await user.tab();
    assert.equal(refusalsShown().length, 1, "leaving a seat's field judges nothing");

    // A switch left off is missing rather than wrong, so it speaks once send was pressed; from then on
    // the press alone moves its message, there being no blur for a switch to wait on.
    await user.click(screen.getByRole("button", { name: "Bewerbung abschicken" }));
    assert.ok(switchSays().includes(refusedSentence), "a blocked submit leaves the switch unmarked, so nothing below is judged");

    await user.click(switchLabel());
    assert.ok(!switchSays().includes(refusedSentence), "switching the confirmation on leaves its refusal standing");

    await user.click(switchLabel());
    assert.ok(switchSays().includes(refusedSentence), "switching the confirmation off again says nothing until something else happens");
  });

  /* `FieldLabel` reads a `DraftStatusProvider` this page has none of, and `fieldLabelPaths.test.ts`
     would then hold these paths against a descriptor table the slice does not keep for them. */
  it("labels its fields plainly, holding no draft status it cannot carry", () => {
    assert.throws(
      () => renderMarkup(FieldLabel, { path: "schule.team_name", children: "Teamname" }),
      // The control: without it a `FieldLabel` that had stopped reading the provider would render
      // here quietly, and the two assertions below would pass over a page carrying draft markers.
      /DraftStatusProvider/,
      "the draft-status label renders without a provider, so this case proves nothing",
    );

    for (const [name, html] of [
      ["the form", FORM_MARKUP],
      ["the new-school arm", NEW_SCHOOL_MARKUP],
    ] as const) {
      assert.doesNotMatch(html, /id="field-/, `${name} renders a draft-status label's rail anchor`);
      assert.match(html, /data-slot="label"[^>]*>[^<]/, `${name} renders no label at all`);
    }
  });

  /* The Trainer LAST, so the claim on its panel names a seat already typed
     (`fl_frontend/src/features/teams/constants.ts :: KONTAKT_ROLLEN`). */
  it("asks for the Trainer last, behind the two seats its claim can name", () => {
    assert.deepEqual(
      [...FORM_MARKUP.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((hit) => hit[1]),
      ["Schule", "Ansprechperson", "Stellvertretung", "Trainerin oder Trainer", "Kenntnisnahme", "Team"],
      "the form no longer asks the Trainer last, or renamed a panel",
    );
    // The payload's own keys in the same order, so a renamed panel heading cannot hide a reordering.
    assert.deepEqual(
      [...FORM_MARKUP.matchAll(/name="kontakte\.(\w+)\.vorname"/g)].map((hit) => hit[1]),
      ["ansprechperson", "stellvertretung", "trainer"],
      "the seats are rendered in an order their headings do not show",
    );
  });

  /* Inside the guard, a school picking a club the league already holds is never asked, and submits a
     body the payload refuses on a box that arm never rendered, so nothing marks it. */
  it("asks the Abi-Jahrgang of an applicant who picked a club the league already holds", () => {
    // The control: without it a picked-club arm that had started rendering the new-school block would
    // leave the assertion below true for the wrong reason.
    assert.doesNotMatch(EXISTING_SCHOOL, /name="schule\.team_name"/, "the new-school block renders in the picked-club arm too");

    assert.ok(
      namedControls(EXISTING_SCHOOL).some((control) => control.name === "stufengroesse"),
      "the Abi-Jahrgang box sits behind the new-school guard, so this applicant is never asked",
    );
  });

  /* One control, one payload field: two independent ticks would let a submission say that two
     different people are both the coach, which `trainer_ist_zugleich` cannot express. */
  it("makes the claim through one control, on the Trainer's panel alone", () => {
    const claimControls = namedControls(FORM_MARKUP).filter((control) => control.name === "kontakte.trainer_ist_zugleich");

    assert.equal(claimControls.length, 1, "the claim is offered on a number of panels other than the Trainer's own");
    // The two seats the claim POINTS AT stand above it and offer none: the question is answered
    // where the Trainer is asked for, about people the applicant has already typed.
    const aboveTheTrainer = FORM_MARKUP.slice(0, FORM_MARKUP.indexOf(">Trainerin oder Trainer<"));

    assert.notEqual(aboveTheTrainer.length, FORM_MARKUP.length, "the Trainer panel's heading is gone, so this case compares nothing");
    assert.doesNotMatch(aboveTheTrainer, /name="kontakte\.trainer_ist_zugleich"/, "a seat the claim can name offers the claim itself");
  });

  /* The group has no off: „Eine andere Person" is an ANSWER, so the claim is re-pointed and the
     `null` it writes is what the wire stores. */
  it("writes the pressed answer, and offers the question on the Trainer seat alone", async () => {
    const { user } = renderApplicationPage();
    const answers = () => screen.getAllByRole("radio");

    assert.equal(answers().length, TRAINER_ZUGLEICH_OPTIONS.length, "a second panel offers the claim, or the Trainer's lost it");

    // Both writes, because „not answered yet" has no spelling on the wire: without the second, a
    // pressed „Eine andere Person" would leave the group looking as though nobody had answered.
    await user.click(screen.getByRole("radio", { name: "Eine andere Person" }));
    assert.deepEqual(
      answers()
        .filter((antwort) => antwort.getAttribute("aria-checked") === "true")
        .map((antwort) => antwort.textContent.trim()),
      ["Eine andere Person"],
      "the press moves the draft without moving what the picker shows",
    );

    await user.click(screen.getByRole("radio", { name: "Die Ansprechperson" }));
    // Two seats' worth of boxes where three stood: the claimed Trainer reads the named seat instead.
    assert.equal(screen.getAllByRole("textbox", { name: "Vorname" }).length, 2, "the claim leaves the Trainer's own boxes open");
    assert.ok(
      screen.queryByText("Die Angaben der Ansprechperson gelten auch für die Trainerin oder den Trainer."),
      "the claim writes nothing the Trainer's panel says",
    );
  });

  /* The strong box clamps what it SHOWS to the lowered squad on its own; a draft left on the old count is
     refused at submit under two boxes reading alike. */
  it("brings the strong count down with a lowered squad the boxes show", async () => {
    const user = userEvent.setup({ delay: null });
    const onKaderChange = mock.fn();
    render(
      h(FormTeamSection, {
        trikot: { vorhandener_satz: "", wunschfarbe: null },
        kader: { voraussichtliche_groesse: 25, gute_spieler: 20 },
        wunschgegner: "",
        schulen: SCHOOLS,
        vergebeneFarben: [],
        onTrikotChange: () => undefined,
        onKaderChange: onKaderChange,
        onWunschgegnerChange: () => undefined,
        onFieldLeft: () => undefined,
        onFarbePicked: () => undefined,
      }),
    );

    await typeInto(user, screen.getByRole("textbox", { name: "Voraussichtliche Kadergröße" }), "12");

    assert.deepEqual(
      onKaderChange.mock.calls.map(({ arguments: [kader] }) => kader).at(-1),
      { voraussichtliche_groesse: 12, gute_spieler: 12 },
      "the draft keeps a strong count above the squad the boxes show",
    );
  });
});

describe("what a refusal on a switch has to land on", () => {
  /* A `Switch` takes no `name`, so nothing it stands for appears in `form.elements`. Without the
     name on its own checkbox, `focusFirstRefusal` reports `rendered` false and the applicant gets
     the unhandled-path toast instead of a message under the control. */
  it("gives every switch on this form a control a refusal can reach", () => {
    const allSwitches = switchesIn(FORM_MARKUP);

    // A floor of ONE: the Kenntnisnahme is the only switch left, the claim having become a toggle
    // group and the three per-seat acknowledgements one press.
    assert.ok(allSwitches.length >= 1, "the form renders no switches, so this case compares nothing");
    for (const control of allSwitches) {
      assert.notEqual(control.name, "", "a switch carries no name, so a refusal on its path reaches no control");
      // Required-ness only where the schema demands it: the zugleich claim is one a school may leave alone.
      const shouldTick = control.name.endsWith("einwilligung.erteilt");
      assert.equal(/aria-required="true"/.test(control.attrs), shouldTick, `${control.name} states a requirement the schema does not`);
    }
  });

  /* The name is only worth what it matches: the path the schema REFUSES on is what reaches
     `setSubmitFieldErrors`, so the control has to carry that exact string. */
  it("names the path the schema itself refuses the claim under", () => {
    const parsedClaim = FLPostBewerbungPayloadSchema.safeParse({ kontakte: { trainer_ist_zugleich: "trainer" } });

    assert.equal(parsedClaim.success, false, "a claim naming no offerable seat is no longer refused");
    const refusedPath = Object.keys(toFieldErrors(parsedClaim.error)).find((entry) => entry.endsWith("trainer_ist_zugleich"));

    assert.ok(refusedPath !== undefined, "the schema refuses the claim under no path at all");
    assert.ok(
      namedControls(FORM_MARKUP).some((control) => control.name === refusedPath),
      `no control on this form is named ${refusedPath ?? ""}`,
    );
  });
});

describe("how the Kenntnisnahme panel sits among the sections around it", () => {
  /* A panel titled below its siblings' level reads as a group inside the one before it, which is
     where an applicant looked for their Kenntnisnahme and found the Trainer's fields. */
  it("wears the frame and the heading level every other section wears", () => {
    const panel = formPanel();
    const headerPattern = new RegExp(`<div class="${panel.header()}"><div><h2 class="${panel.heading()} inline">([^<]*)</h2>`, "g");
    const panelTitles = [...FORM_MARKUP.matchAll(headerPattern)].map((hit) => hit[1] ?? "");

    assert.ok(panelTitles.includes("Kenntnisnahme"), "the Kenntnisnahme panel titles itself some other way than its siblings do");
    assert.equal(panelTitles.length, 6, `the form frames ${String(panelTitles.length)} sections rather than its six`);
  });

  /* The wording is stamped and may not be shortened, so the type step it is set at is the only lever
     left on how long the block reads. */
  it("sets the stamped wording at the muted caption step, one recipe for all of it", () => {
    assert.equal(
      [...FORM_MARKUP.matchAll(/<p class="muted-meta">/g)].length,
      LIGA_KENNTNISNAHME.absaetze.length,
      "a stamped paragraph is set in something other than the panel's own muted recipe",
    );
  });

  /* The form is the submitting Ansprechperson's first contact, and Art. 21(4) DSGVO asks the objection
     there apart from every other piece of information: a clause inside another paragraph is not that. */
  it("renders the objection as a paragraph of its own", () => {
    assert.ok(
      FORM_MARKUP.includes(
        '<p class="muted-meta">Der Verarbeitung Deiner Angaben kannst Du jederzeit aus Gründen widersprechen, die sich aus Deiner besonderen Situation ergeben (Art. 21 DSGVO).</p>',
      ),
      "the form states no objection, or states it inside another paragraph",
    );
  });

  /* A `FieldError` with nothing to say renders no element, so the class is read off a refusal the
     form hands the switch by the name the switch itself renders. */
  it("starts the switch's refusal on the label's own edge", () => {
    const section = h(FormEinwilligungSection, { erteilt: false, onErteiltPicked: () => undefined });
    const name = /<input\b[^>]*\bname="([^"]+)"/.exec(renderTree(h(Form, { validationBehavior: "aria" }, section)))?.[1];
    assert.ok(name !== undefined, "the Kenntnisnahme switch renders no named control, so no refusal can reach it");

    const refused = renderTree(h(Form, { validationBehavior: "aria", validationErrors: { [name]: "Bestätige die Kenntnisnahme." } }, section));
    const message = /<\w+\b([^>]*\bdata-slot="field-error"[^>]*)>Bestätige die Kenntnisnahme\.</.exec(refused)?.[1];
    assert.ok(message !== undefined, "a refusal handed to the switch's name renders no message under it");

    const wornClasses = (/\bclass="([^"]*)"/.exec(message)?.[1] ?? "").split(/\s+/);
    for (const token of FIELD_ERROR_SWITCH.split(/\s+/)) {
      assert.ok(
        wornClasses.includes(token),
        `the switch's message wears a text field's recipe: ${token} is missing from ${wornClasses.join(" ")}`,
      );
    }
    assert.ok(FIELD_ERROR_SWITCH.startsWith(FIELD_ERROR), "the switch recipe is no longer the field recipe with a start added");
    assert.match(FIELD_ERROR_SWITCH, /\bps-\d/, "the switch recipe writes no start of its own, so HeroUI's reservation stands");
  });
});

/*
 The page is read rather than rendered: each claim here is about the shape of the module rather than
 about markup.
*/
describe("the public application page", () => {
  /* `docs/frontend/spec.md :: I22`: a dynamic segment awaits `params` INSIDE its boundary. A
     top-level await ties the fallback-params App Shell to one URL. */
  it("awaits connection() inside the boundary and exports a synchronous default", () => {
    assert.match(PAGE, /import \{ connection \} from "next\/server";/, "the page no longer imports connection");

    // Split at the default export first: `generateMetadata` keeps its own await deliberately, being
    // no part of the shell, and reading the file whole would count that one as the shell's.
    const [, nachMetadata = ""] = PAGE.split("export default function");
    const [chrome, boundary] = nachMetadata.split("<Suspense");

    assert.match(PAGE, /export async function generateMetadata/, "the page publishes no metadata of its own");
    assert.ok(boundary !== undefined, "the page renders no Suspense boundary");
    assert.ok(!chrome!.includes("await connection()"), "the page awaits connection above its own boundary");
    assert.match(PAGE, /^export default function /m, "the page awaits its data before the chrome renders");
    assert.doesNotMatch(PAGE, /^export default async /m, "the page awaits its data before the chrome renders");
  });

  /* `[saison_id]` and never `[saison]`: `resolveSaisonIdParam` reads `params.saison_id`, so the
     other spelling 404s every request with nothing in the type system reporting it. */
  it("resolves the segment by the name the resolver reads, and 404s a miss", () => {
    assert.match(PAGE, /resolveSaisonIdParam\(props\.params\)/, "the page resolves its season some other way");
    assert.match(PAGE, /NextPageProps<\{ saison_id: string \}>/, "the page types its params under another key");
  });

  /* An anonymous visitor reads the club list. A closed page showing no picker has no business
     reading it at all (`READ-BEWERBUNG-001`). */
  it("reads the club list only while the window is running", () => {
    assert.match(PAGE, /fenster\.fenster\?\.laeuft === true$/m, "the club list is read on a page that shows no picker");
  });
});

describe("what the form guards before the draft is sent", () => {
  /* A long form, entered once, by somebody who has it saved nowhere else. */
  it("warns before an unload that would lose the draft", async () => {
    const { user, container } = renderApplicationPage();
    assert.equal(asksBeforeLeaving(), false, "an untouched form holds up a reader leaving it");

    await typeInto(user, control(container, "kontakte.ansprechperson.vorname"), "Anna", { leaveBox: true });
    assert.equal(asksBeforeLeaving(), true, "an unload takes the draft with it silently");
  });

  /* Every write to the draft goes through one setter, so nothing can move it without arming the
     browser's prompt. A claim over every write the form holds, where a render arms it through the
     writes one case makes. */
  it("moves the draft through the one setter that arms that warning", () => {
    const raw = [...FORM.matchAll(/(?<![A-Za-z])setDraft\(/g)];
    assert.equal(raw.length, 1, "a draft write bypasses applyDraft, so it moves the form without arming the warning");
  });
});

describe("what the form says about itself to a reader who cannot see it", () => {
  /* `aria-label` beside a visible `<Label>` is not a second name — react-aria emits no label id at
     all, and the non-empty `aria-labelledby` then outranks the `aria-label` too. The control
     announces its placeholder. */
  it("names no control twice, so its visible label is the name it announces", () => {
    for (const [wo, html] of [
      ["the form", FORM_MARKUP],
      ["the new-school arm", NEW_SCHOOL_MARKUP],
    ] as const) {
      const controls = namedControls(html);
      const ids = new Set([...html.matchAll(/\bid="([^"]*)"/g)].map((hit) => hit[1]));
      let namedCount = 0;

      assert.ok(controls.length > 5, `${wo} renders too few controls for this case to compare anything`);
      for (const control of controls) {
        assert.doesNotMatch(control.attrs, /\baria-label="/, `${wo}: ${control.name} is named twice, so it announces its placeholder`);

        for (const target of (/\baria-labelledby="([^"]*)"/.exec(control.attrs)?.[1] ?? "").split(" ").filter(Boolean)) {
          assert.ok(ids.has(target), `${wo}: ${control.name} is labelled by an element this page does not render`);
          assert.match(html, new RegExp(`id="${target}"[^>]*>[^<]`), `${wo}: ${control.name} is labelled by an element with no words in it`);
          namedCount += 1;
        }
      }

      assert.ok(namedCount > 0, `${wo} resolves no accessible name at all, so the loop above compared nothing`);
    }
  });

  /* Without HeroUI forwarding `aria-describedby` to its own input, this hint would describe nothing,
     and the picker's `<p id>` pattern would be the only way to reach a reader who cannot see it. */
  it("describes the Abi-Jahrgang box by the hint sitting under it", () => {
    const hintId = /<p id="([^"]*)"[^>]*>Alle Schülerinnen und Schüler/.exec(NEW_SCHOOL_MARKUP)?.[1] ?? "";

    assert.notEqual(hintId, "", "the school panel renders no Abi-Jahrgang hint, so this case compares nothing");

    const describedByHint = [...NEW_SCHOOL_MARKUP.matchAll(/<input\b([^>]*)>/g)]
      .map((hit) => /\baria-describedby="([^"]*)"/.exec(hit[1] ?? "")?.[1] ?? "")
      .filter((value) => value.split(" ").includes(hintId));

    assert.equal(describedByHint.length, 1, "the Abi-Jahrgang hint reaches no input, so a screen reader never meets the sentence");
  });

  /* The receipt replaces the form under the pressed button, so without these the caret falls to `<body>`
     and nothing is announced; and with the application in, nothing is left for an unload to lose. */
  it("hands the receipt the caret and a live announcement, and holds up no unload", async () => {
    const { receipt } = await submitApplication();

    assert.ok(document.activeElement === receipt, "the caret is left somewhere other than on the receipt");
    assert.ok(
      within(receipt).queryByRole("heading", { name: "Deine Bewerbung ist eingegangen" }),
      "the region the form announces is something other than the receipt",
    );
    assert.equal(receipt.getAttribute("tabindex"), "-1", "the receipt sits in the tab order as well as taking the caret");
    assert.equal(asksBeforeLeaving(), false, "the receipt holds up a reader whose application is already in");
  });
});

describe("the receipt the form leaves in its own place", () => {
  /* The box is the confirmation page's recipe
     (`fl_frontend/src/features/bewerbungen/components/views/BestaetigungPanels.tsx :: ergebnisPanel`).
     A literal spelling its classes renders identically, so which of the two stands here is legible
     in the source alone. */
  it("takes the tinted panel the confirmation page wears rather than dressing one", () => {
    // Read at the recipe first: one emitting no tint at all satisfies the two claims under it.
    assert.match(ergebnisPanel({ tone: "erfolg" }), /(^|\s)bg-success\/10(\s|$)/, "the shared panel lost its success tint");

    assert.match(FORM, /className=\{ergebnisPanel\(\{ tone: "erfolg" \}\)\}/, "the receipt dresses a box of its own");
    assert.doesNotMatch(blankComments(FORM), /bg-success\/|border-success\//, "the receipt spells a success tint beside the recipe");
  });

  /* The receipt swaps itself in for the form alone, so the page's strip goes with the form, and an
     invitation read out with the receipt buries the answer the applicant pressed for. */
  it("repeats the page's own strip under the receipt, outside the live region", async () => {
    const { container, receipt } = await submitApplication();
    const strip = textOf(renderMarkup(BewerbungInstagramBand, {}));

    assert.equal(container.textContent.split("@frankfurt.league").length - 1, 1, "the receipt page draws the invitation other than once");
    assert.ok(!receipt.textContent.includes("@frankfurt.league"), "the live region reads the invitation out along with the receipt");
    assert.equal(receipt.nextElementSibling?.textContent, strip, "the receipt is followed by something other than the page's strip");
  });

  /* The panel and the messages state the same fan-out: told one seat was written to, the submitter
     chases nobody, and the two unopened links delete the application on the deadline. Every seat's
     label is read off `BEWERBUNG_SEATS`. */
  it("names the link every contact person holds, and singles out no seat", async () => {
    const receiptParagraph = ((await submitApplication()).receipt.querySelector("p")?.textContent ?? "").replace(/\s+/g, " ").trim();
    const linkSentence = receiptParagraph.split(".").find((part) => part.includes("Link")) ?? "";

    assert.ok(linkSentence !== "", "the panel names no confirmation link at all");
    assert.match(linkSentence, /[Jj]ede Kontaktperson/, "the link sentence no longer says every contact person was written to");
    assert.match(linkSentence, /eigenen Link/, "the link sentence no longer says the link is that person's own");

    for (const { label } of BEWERBUNG_SEATS) {
      assert.ok(!receiptParagraph.includes(label), `the panel singles out ${label} where every seat holds a link`);
    }

    // „eingegangen“ is not „vollständig“: an applicant told otherwise stops chasing the two people
    // the application is still waiting for.
    assert.match(
      receiptParagraph,
      /[Vv]ollständig[^.]*sobald alle drei bestätigt haben/,
      "the panel never says what makes the application complete",
    );
    assert.doesNotMatch(receiptParagraph, /nichts weiter tun/, "the panel calls the workflow finished while three links are open");

    // The clock the sweep deletes on, and no digit in the copy for any other purpose.
    assert.deepEqual(
      receiptParagraph.match(/\d+/g),
      [String(BEWERBUNG_BESTAETIGUNG_FRIST_TAGE)],
      "the panel states a clock other than the sweep's",
    );
    // Read beside the render: a number typed at the bound's value renders the same sentence, and outlives a changed bound.
    assert.match(FORM, /\{String\(BEWERBUNG_BESTAETIGUNG_FRIST_TAGE\)\} Tagen/, "the panel states a deadline it did not read off the bound");

    // The decision DOES reach all three, and the panel has to say so or the applicant waits on nothing.
    assert.match(receiptParagraph, /alle[nr]? drei Kontaktpersonen/, "the panel never says the decision reaches all three");
  });
});
