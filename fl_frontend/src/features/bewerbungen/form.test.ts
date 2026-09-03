import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { toFieldErrors } from "@/shared/utils/validation";

import { BEWERBUNG_SEATS } from "./constants.ts";
import { FLPostBewerbungPayloadSchema } from "./schemas.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..");

const read = (...parts: string[]): string => readFileSync(path.join(SRC_DIR, ...parts), "utf8");

const FORM = read("features", "bewerbungen", "components", "forms", "BewerbungForm", "BewerbungForm.tsx");
const SEATS = read("features", "bewerbungen", "components", "forms", "BewerbungForm", "FormKontaktpersonenSection.tsx");
const SCHULE = read("features", "bewerbungen", "components", "forms", "BewerbungForm", "FormSchuleSection.tsx");
const PAGE = read("app", "(public)", "bewerbung", "[saison_id]", "page.tsx");
const CONSTANTS = read("features", "bewerbungen", "constants.ts");

describe("the public application form", () => {
  /* First, because every assertion below reads one of these as text: a path that stopped resolving
     would leave each of them matching against an empty string and reporting nothing. */
  it("finds each file it reads at all", () => {
    for (const [name, source] of [
      ["the form", FORM],
      ["the seats", SEATS],
      ["the school section", SCHULE],
      ["the page", PAGE],
      ["the constants", CONSTANTS],
    ] as const) {
      assert.ok(source.length > 0, `${name} is empty, so this file proves nothing about it`);
    }
  });

  /* One composer, so the submit cannot assemble a second payload beside the one the blur-time
     judgements parse. What that composer does is pinned by `schemas.test.ts`, against values. */
  it("submits the payload one composer built, the same one every blur-time judgement parses", () => {
    assert.match(FORM, /const payload = bewerbungPayload\(draft\);/, "the submit posts something other than the composed payload");

    /* A payload assembled here rather than by `bewerbungPayload` would have to name the field the
       draft no longer carries. `["team_id"]` is a judged PATH, not a key, so it is not one. */
    assert.doesNotMatch(FORM, /team_id:/, "the form assembles a payload of its own beside bewerbungPayload");
  });

  /* `location = /api/bewerbung/kuerzel` is an EXACT match, so a path segment falls through to the
     catch-all with no limit, and neither `nginx -t` nor the build can see it. */
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

  /* A ratified decision (`.claude/rules/frontend.md`): a typed field is judged when it is LEFT. A message
     between two keystrokes describes a value nobody finished entering. */
  it("judges a typed field on blur and a picked one on the press", () => {
    assert.match(SEATS, /onBlur=\{\(\) => onFieldLeft\(\[path\("vorname"\)\]\)\}/, "a typed seat field is judged elsewhere");
    assert.ok(!/onChange=\{\(next\) => \{[^}]*onFieldLeft/.test(SEATS), "a change handler judges a seat's field between keystrokes");
    assert.match(SEATS, /onPersonPicked\(\[path\("einwilligung\.erteilt"\)\], next\)/, "the picked consent is judged elsewhere");
  });

  /* `FieldLabel` reads a `DraftStatusProvider` this page has none of, and `fieldLabelPaths.test.ts`
     would then hold these paths against a descriptor table the slice does not keep for them. */
  it("labels its fields plainly, holding no draft status it cannot carry", () => {
    for (const [name, source] of [
      ["the seats", SEATS],
      ["the school section", SCHULE],
    ] as const) {
      assert.ok(!source.includes("<FieldLabel"), `${name} renders a draft-status label on a page that keeps no draft status`);
      assert.match(source, /<Label className=\{FIELD_LABEL\}>/, `${name} renders no plain label at all`);
    }
  });

  /* The Trainer first: it is the seat a school fills in first when it thinks about who is coming,
     and the two contacts follow from it. */
  /* Read from the constant rather than from its source text: the order is what the form renders, and
     a re-indent must not be able to fail this or, worse, pass it vacuously. */
  it("asks for the Trainer first, ahead of the two seats that can claim to be one", () => {
    assert.deepEqual(
      BEWERBUNG_SEATS.map((seat) => seat.value),
      ["trainer", "ansprechperson", "stellvertretung"],
      "BEWERBUNG_SEATS no longer asks the Trainer first",
    );
  });

  /* The one control the claim is made with. Two independent ticks would let a submission say that
     two different people are both the coach, which `trainer_ist_zugleich` cannot express. */
  it("makes the claim through the one nullable field, so no press can put it on two seats", () => {
    assert.match(FORM, /trainer_ist_zugleich: seat/, "the claim is written as something other than the one field");
    assert.match(FORM, /onZugleichToggled=\{value === "trainer" \? undefined : \(on\) => pickZugleich\(on \? value : null\)\}/);
  });
});

describe("what a refusal on a switch has to land on", () => {
  /* A `Switch` takes no `name`, so nothing it stands for appears in `form.elements`. Without a named
     proxy around it, `focusFirstRefusal` reports `rendered` false and the applicant gets the
     unhandled-path toast instead of a message under the control. */
  it("gives every switch on this form a control a refusal can reach", () => {
    // The switch carries the NAME itself, so its own checkbox is what `aria-invalid` and the message's
    // `aria-describedby` land on. Behind a proxy the refusal reached a control nothing announces.
    const schalter = [...SEATS.matchAll(/<Switch[^.\w]/g)];
    assert.ok(schalter.length >= 2, "the seats render no switches, so this case compares nothing");

    for (const treffer of schalter) {
      const block = SEATS.slice(treffer.index, SEATS.indexOf(">", treffer.index));

      assert.match(block, /name=\{/, "a switch carries no name, so a refusal on its path reaches no control");
      // Required-ness only where the schema demands it: the zugleich claim is one a school may leave alone.
      if (block.includes("einwilligung.erteilt")) assert.match(block, /isRequired/, "a consent switch says its requirement to nobody");
    }
  });

  /* The name is only worth what it matches: the path the schema REFUSES on is what reaches
     `setSubmitFieldErrors`, so the control has to carry that exact string. */
  it("names the path the schema itself refuses the claim under", () => {
    const geparst = FLPostBewerbungPayloadSchema.safeParse({ kontakte: { trainer_ist_zugleich: "trainer" } });

    assert.equal(geparst.success, false, "a claim naming no offerable seat is no longer refused");
    const pfad = Object.keys(toFieldErrors(geparst.error)).find((eintrag) => eintrag.endsWith("trainer_ist_zugleich"));

    assert.ok(pfad !== undefined, "the schema refuses the claim under no path at all");
    assert.ok(SEATS.includes(`"${pfad}"`), `no control on this form names ${pfad ?? ""}`);
  });
});

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
  /* `aria-label` beside a visible `<Label>` is not a second name — react-aria emits no label id at all, and the
     non-empty `aria-labelledby` then outranks the `aria-label` too. The control announces its placeholder. */
  it("names no control twice, so its visible label is the name it announces", () => {
    for (const [datei, quelle] of [
      ["FormSchuleSection.tsx", SCHULE],
      ["FormKontaktpersonenSection.tsx", SEATS],
    ] as const) {
      for (const treffer of quelle.matchAll(/aria-label="/g)) {
        const block = quelle.slice(Math.max(0, treffer.index - 600), treffer.index + 600);

        assert.ok(!block.includes("<Label"), `${datei} sets an aria-label on a control that renders its own Label`);
      }
    }
  });

  /* Every answer the schema demands says so, or it carries no asterisk, no `aria-required` and no mark of any
     kind — and the applicant meets the requirement only when the submit refuses it. */
  it("marks the birthdate required, as the schema's own span rule demands", () => {
    const block = SEATS.slice(SEATS.indexOf("<DatePicker"), SEATS.indexOf(">", SEATS.indexOf("<DatePicker")));

    assert.match(block, /isRequired/, "the birthdate is refused by the schema and asks for nothing");
  });

  /* The receipt replaces the form under the pressed button, so without these the caret falls to `<body>` and
     nothing is announced on the page somebody has just spent twenty minutes on. */
  it("announces the receipt and takes the caret the form drops", () => {
    // Anchored to a line of its own: the comment above the receipt names `role="status"` too, and a loose
    // match is satisfied by the prose while the attribute is gone.
    assert.match(FORM, /^ +role="status"$/m, "the receipt is in no live region");
    assert.match(FORM, /tabIndex=\{-1\}/, "the receipt cannot take focus");
    assert.match(FORM, /eingereichtRef\.current\?\.focus\(\)/, "nothing moves focus to the receipt");
  });
});
