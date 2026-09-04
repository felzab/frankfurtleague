import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { renderMarkup } from "@/shared/testing/renderTest";
import { toFieldErrors } from "@/shared/utils/validation";

import { FLPostBewerbungPayloadSchema } from "./schemas.ts";

/*
 Every module below is reached AFTER the harness above has evaluated, because that is when the JSX
 compile step is registered; a static import beside it resolves first and dies on the extension.
*/
const { BewerbungForm } = await import("./components/forms/BewerbungForm/BewerbungForm.tsx");
const { FormSchuleSection } = await import("./components/forms/BewerbungForm/FormSchuleSection.tsx");
const { FieldLabel } = await import("@/shared/components/ui/FieldLabel.tsx");
const { SCHULE_NICHT_IN_LISTE } = await import("./constants.ts");
const { buildEmptyBewerbungSchule } = await import("./utils.ts");

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..");

const read = (...parts: string[]): string => readFileSync(path.join(SRC_DIR, ...parts), "utf8");

const FORM = read("features", "bewerbungen", "components", "forms", "BewerbungForm", "BewerbungForm.tsx");
const SEATS = read("features", "bewerbungen", "components", "forms", "BewerbungForm", "FormKontaktpersonenSection.tsx");
const PAGE = read("app", "(public)", "bewerbung", "[saison_id]", "page.tsx");

const SCHULEN = [{ id: "68d0f2a4c1e2b3a4d5e6f708", name: "Lessing-Kolleg" }];

/** The form as the applicant meets it, composed by the component the page renders rather than here. */
const FORMULAR = renderMarkup(BewerbungForm, { saisonId: "2026", schulen: SCHULEN, isSchulenLesbar: true, vergebeneFarben: [] });

/**
 * The new-school arm, which the form above never reaches: it opens on the picker's sentinel, and a
 * fresh draft has picked nothing.
 */
const NEUE_SCHULE = renderMarkup(FormSchuleSection, {
  schulen: SCHULEN,
  auswahl: SCHULE_NICHT_IN_LISTE,
  schule: buildEmptyBewerbungSchule(),
  onAuswahlPicked: () => undefined,
  onSchuleChange: () => undefined,
  onFieldLeft: () => undefined,
  onSchulformPicked: () => undefined,
  onKuerzelLeft: () => undefined,
  kuerzelHinweis: null,
  isSchulenLesbar: true,
});

/** Every element a submitted value is read off, with the attributes that decide what it announces. */
function benannteControls(html: string): { name: string; attrs: string }[] {
  return [...html.matchAll(/<(?:input|select|textarea)\b([^>]*)>/g)]
    .map((treffer) => ({ attrs: treffer[1] ?? "", name: /\bname="([^"]*)"/.exec(treffer[1] ?? "")?.[1] ?? "" }))
    .filter((control) => control.name !== "");
}

/** Every switch, as the refusal has to find it: by the payload path its own checkbox carries. */
const schalter = (html: string): { name: string; attrs: string }[] =>
  [...html.matchAll(/<input\b([^>]*\brole="switch"[^>]*)>/g)].map((treffer) => ({
    attrs: treffer[1] ?? "",
    name: /\bname="([^"]*)"/.exec(treffer[1] ?? "")?.[1] ?? "",
  }));

describe("the public application form", () => {
  /* First, because every source-text case below reads one of these: a path that stopped resolving
     would leave each of them matching against an empty string and reporting nothing. */
  it("finds each file it reads at all", () => {
    for (const [name, source] of [
      ["the form", FORM],
      ["the seats", SEATS],
      ["the page", PAGE],
    ] as const) {
      assert.ok(source.length > 0, `${name} is empty, so this file proves nothing about it`);
    }
  });

  /* One composer, so the submit cannot assemble a second payload beside the one the blur-time
     judgements parse. Which composer a handler calls is not in the markup it produces. */
  it("submits the payload one composer built, the same one every blur-time judgement parses", () => {
    assert.match(FORM, /const payload = bewerbungPayload\(draft\);/, "the submit posts something other than the composed payload");

    /* A payload assembled here rather than by `bewerbungPayload` would have to name the field the
       draft no longer carries. `["team_id"]` is a judged PATH, not a key, so it is not one. */
    assert.doesNotMatch(FORM, /team_id:/, "the form assembles a payload of its own beside bewerbungPayload");
  });

  /* `location = /api/bewerbung/kuerzel` is an EXACT match in nginx, so a path segment falls through
     to the catch-all with no limit, and neither `nginx -t` nor the build can see it. */
  it("calls both public routes at the exact paths the edge limits", () => {
    assert.match(FORM, /fetch\("\/api\/bewerbung", \{/, "the submission posts to something other than /api/bewerbung");
    assert.match(
      FORM,
      /fetch\(`\/api\/bewerbung\/kuerzel\?shorthand=\$\{encodeURIComponent\(shorthand\)\}`\)/,
      "the check uses a path segment",
    );
    assert.ok(!FORM.includes('"/api/bewerbung/"'), "a trailing slash falls through to the unlimited catch-all");
  });

  /* A `limit_req` 429 is generated before either route handler runs, so it carries nginx's HTML and
     none of the always-200 envelope. Read as a transport failure it tells an applicant nothing about
     the one remedy it has, which is to wait. */
  it("answers the edge's rate limit in its own words on both calls", () => {
    const antworten = [...FORM.matchAll(/if \(response\.status === RATE_LIMIT_STATUS\) return/g)];

    assert.equal(antworten.length, 2, "one of the two calls reads a 429 as a transport failure");
    assert.match(FORM, /const RATE_LIMIT_STATUS = 429;/);
    assert.match(FORM, /Zu viele Versuche in kurzer Zeit/);
  });

  /* A ratified decision (`.claude/rules/frontend.md`): a typed field is judged when it is LEFT. A
     message between two keystrokes describes a value nobody finished entering. Which event a handler
     is bound to reaches no markup. */
  it("judges a typed field on blur and a picked one on the press", () => {
    assert.match(SEATS, /onBlur=\{\(\) => onFieldLeft\(\[path\("vorname"\)\]\)\}/, "a typed seat field is judged elsewhere");
    assert.ok(!/onChange=\{\(next\) => \{[^}]*onFieldLeft/.test(SEATS), "a change handler judges a seat's field between keystrokes");
    // One press answers for all three seats, so `BewerbungForm` judges the three paths it wrote;
    // what this panel owes is that the press is what reports it at all.
    assert.match(SEATS, /onChange=\{onErteiltPicked\}/, "the confirmation is judged on something other than the press");
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
      ["the form", FORMULAR],
      ["the new-school arm", NEUE_SCHULE],
    ] as const) {
      assert.doesNotMatch(html, /id="feld-/, `${name} renders a draft-status label's rail anchor`);
      assert.match(html, /data-slot="label"[^>]*>[^<]/, `${name} renders no label at all`);
    }
  });

  /* The Trainer LAST, so the claim on its panel names a seat already typed
     (`fl_frontend/src/features/teams/constants.ts :: KONTAKT_ROLLEN`). The confirmation block
     carries no heading of its own, which is why five headings answer for six sections. */
  it("asks for the Trainer last, behind the two seats its claim can name", () => {
    assert.deepEqual(
      [...FORMULAR.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((treffer) => treffer[1]),
      ["Schule", "Ansprechperson", "Stellvertretung", "Trainerin oder Trainer", "Team"],
      "the form no longer asks the Trainer last, or renamed a panel",
    );
    // The payload's own keys in the same order, so a renamed panel heading cannot hide a reordering.
    assert.deepEqual(
      [...FORMULAR.matchAll(/name="kontakte\.(\w+)\.vorname"/g)].map((treffer) => treffer[1]),
      ["ansprechperson", "stellvertretung", "trainer"],
      "the seats are rendered in an order their headings do not show",
    );
  });

  /* One control, one payload field: two independent ticks would let a submission say that two
     different people are both the coach, which `trainer_ist_zugleich` cannot express. */
  it("makes the claim through one control, on the Trainer's panel alone", () => {
    const anspruch = benannteControls(FORMULAR).filter((control) => control.name === "kontakte.trainer_ist_zugleich");

    assert.equal(anspruch.length, 1, "the claim is offered on a number of panels other than the Trainer's own");
    // The two seats the claim POINTS AT stand above it and offer none: the question is answered
    // where the Trainer is asked for, about people the applicant has already typed.
    const vorDemTrainer = FORMULAR.slice(0, FORMULAR.indexOf(">Trainerin oder Trainer<"));

    assert.notEqual(vorDemTrainer.length, FORMULAR.length, "the Trainer panel's heading is gone, so this case compares nothing");
    assert.doesNotMatch(vorDemTrainer, /name="kontakte\.trainer_ist_zugleich"/, "a seat the claim can name offers the claim itself");
  });

  /* The group has no off: „Eine andere Person" is an ANSWER, so the claim is re-pointed and the
     `null` it writes is what the wire stores. Which handler a panel is given reaches no markup. */
  it("writes the pressed answer, and offers the question on the Trainer seat alone", () => {
    assert.match(FORM, /onTrainerWahl=\{value === "trainer" \? pickTrainerWahl : undefined\}/, "a second panel can answer the claim");
    // Both writes, because „not answered yet" has no spelling on the wire: without the second, a
    // pressed „Eine andere Person" would leave the group looking as though nobody had answered.
    assert.match(FORM, /setTrainerWahl\(seat\);/, "the press moves the draft without moving what the picker shows");
  });
});

describe("what a refusal on a switch has to land on", () => {
  /* A `Switch` takes no `name`, so nothing it stands for appears in `form.elements`. Without the
     name on its own checkbox, `focusFirstRefusal` reports `rendered` false and the applicant gets
     the unhandled-path toast instead of a message under the control. */
  it("gives every switch on this form a control a refusal can reach", () => {
    const alle = schalter(FORMULAR);

    // A floor of ONE: the confirmation is the only switch left, the claim having become a toggle
    // group and the three per-seat consents one press.
    assert.ok(alle.length >= 1, "the form renders no switches, so this case compares nothing");
    for (const control of alle) {
      assert.notEqual(control.name, "", "a switch carries no name, so a refusal on its path reaches no control");
      // Required-ness only where the schema demands it: the zugleich claim is one a school may leave alone.
      const soll = control.name.endsWith("einwilligung.erteilt");
      assert.equal(/aria-required="true"/.test(control.attrs), soll, `${control.name} states a requirement the schema does not`);
    }
  });

  /* The name is only worth what it matches: the path the schema REFUSES on is what reaches
     `setSubmitFieldErrors`, so the control has to carry that exact string. */
  it("names the path the schema itself refuses the claim under", () => {
    const geparst = FLPostBewerbungPayloadSchema.safeParse({ kontakte: { trainer_ist_zugleich: "trainer" } });

    assert.equal(geparst.success, false, "a claim naming no offerable seat is no longer refused");
    const pfad = Object.keys(toFieldErrors(geparst.error)).find((eintrag) => eintrag.endsWith("trainer_ist_zugleich"));

    assert.ok(pfad !== undefined, "the schema refuses the claim under no path at all");
    assert.ok(
      benannteControls(FORMULAR).some((control) => control.name === pfad),
      `no control on this form is named ${pfad ?? ""}`,
    );
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

  /* Neither read may fall through to a closed state: a failure that read as „abgelaufen“ would state
     a deadline the page never learnt, and one club list would take the whole form down with it. */
  it("catches both reads rather than letting either become the error page", () => {
    assert.match(PAGE, /getBewerbungFenster\(saison_id\)\.then\(/, "the window read is not caught");
    assert.match(PAGE, /isUnlesbar: true, fenster: null/, "a failed window read is not reported as unreadable");
    assert.match(PAGE, /getBewerbungSchulen\(\)\.then\(/, "the club list read is not caught");
    assert.match(PAGE, /isSchulenLesbar: false, schulen: \[\]/, "a failed club list read is not reported as unread");
  });
});

/*
 Read rather than rendered: each claim here is about what a handler does with a press or an unload,
 and none of it survives into the markup a press acts on.
*/
describe("what the form does with a submit already in flight", () => {
  /* The disabled button is not the whole guard: `Enter` in any field submits the form too, so a
     second press mid-flight would post the application twice. */
  it("returns before the transition rather than posting a second time", () => {
    assert.match(FORM, /const handleSubmit = \(\) => \{\n(?:.*\n)*?    if \(isPending\) return;/, "the submit runs while one is in flight");
    assert.match(FORM, /isDisabled=\{isPending\}/, "the submit button stays pressable mid-flight");
  });

  /* The availability check is rate-limited per address at the edge, and an incomplete code is one the
     route's own `length(2)` can only refuse. Loosened to a comparison, every blur on an empty box
     spends a request out of a budget the complete codes need. */
  it("asks about a code only once it is the full width", () => {
    assert.match(FORM, /if \(shorthand\.length !== KUERZEL_LAENGE\) \{/, "the blur check fires on a code nobody finished typing");
  });

  /* A long form, entered once, by somebody who has it saved nowhere else. Every write to the draft
     goes through one setter, so nothing can move it without arming the browser's prompt. */
  it("warns before an unload that would lose the draft", () => {
    assert.match(FORM, /useUnsavedChangesWarning\(hasTyped && !isEingereicht\)/, "an unload takes the draft with it silently");

    // One call, inside `applyDraft`: a second is a write that moves the form without arming the prompt.
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
      ["the form", FORMULAR],
      ["the new-school arm", NEUE_SCHULE],
    ] as const) {
      const controls = benannteControls(html);
      const ids = new Set([...html.matchAll(/\bid="([^"]*)"/g)].map((treffer) => treffer[1]));
      let benannt = 0;

      assert.ok(controls.length > 5, `${wo} renders too few controls for this case to compare anything`);
      for (const control of controls) {
        assert.doesNotMatch(control.attrs, /\baria-label="/, `${wo}: ${control.name} is named twice, so it announces its placeholder`);

        for (const ziel of (/\baria-labelledby="([^"]*)"/.exec(control.attrs)?.[1] ?? "").split(" ").filter(Boolean)) {
          assert.ok(ids.has(ziel), `${wo}: ${control.name} is labelled by an element this page does not render`);
          assert.match(html, new RegExp(`id="${ziel}"[^>]*>[^<]`), `${wo}: ${control.name} is labelled by an element with no words in it`);
          benannt += 1;
        }
      }

      assert.ok(benannt > 0, `${wo} resolves no accessible name at all, so the loop above compared nothing`);
    }
  });

  /* The receipt replaces the form under the pressed button, so without these the caret falls to
     `<body>` and nothing is announced on the page somebody has just spent twenty minutes on. */
  it("announces the receipt and takes the caret the form drops", () => {
    // Read rather than rendered: the panel arrives on a state transition, not on a prop.

    // Anchored to a line of its own: the comment above the receipt names `role="status"` too, and a loose
    // match is satisfied by the prose while the attribute is gone.
    assert.match(FORM, /^ +role="status"$/m, "the receipt is in no live region");
    assert.match(FORM, /tabIndex=\{-1\}/, "the receipt cannot take focus");
    assert.match(FORM, /eingereichtRef\.current\?\.focus\(\)/, "nothing moves focus to the receipt");
  });
});
