---
paths:
  - "fl_frontend/**/*"
  - "fl_frontend/**/.*"
---

# Traps — the frontend surface

Each fails silently. The ratified decisions for this surface are in `docs/decisions.md`.

- Every page whose address carries a token is in the proxy's mailed-link table
  (`fl_frontend/src/core/mailedLink.ts :: MAILED_LINK_PAGES`), which moves the token into a cookie
  before the page renders, so no history entry, referrer or third-party script receives it. The
  table's docstring and the privacy notice's browser paragraph
  (`fl_frontend/src/core/serverCopy.ts :: legal.privacyNotice.website.browser`) name every way such
  a link reaches a person, and a new way widens both. A new such page is made under `/confirm/`,
  where nginx's prefix already meters it, and joins the table.
- Every kit field a person types into or toggles takes `inert={useFieldWait()}` at its root
  (`fl_frontend/src/kit/FieldParts.tsx :: useFieldWait`) and a row in
  `fl_frontend/src/kit/HeldForm.test.tsx :: FIELDS`; without it, React's next render writes its
  state over what a person typed or pressed before the page hydrated, and `tsc`, the build and every
  field's own tests pass. The lint refuses a raw control anywhere in the kit, and a kit file
  importing React Aria's root or a native-control module `fl_frontend/eslint.config.mjs` lists until
  the file joins that ban's allow-list; joining it silences the ban whether or not the root waits,
  so the `FIELDS` row is the one check of the wait, and a field on any other module that ban never
  sees. A date or time field's segments are `fl_frontend/src/kit/dateParts.tsx :: Segments`' alone,
  by a second ban in the same file, and already wait. A select's trigger opens nothing before
  hydration and a read-only field takes no input, so neither has a state to lose and neither waits.
  The wait is `inert`, never `disabled`, which drops the field from the posted form, nor `readOnly`,
  which leaves a caret and holds no box or radio.
- An act behind the passkey touch asks it from its final press alone, through the `touch` slot of
  `fl_frontend/src/kit/ConfirmDialog.tsx` or `fl_frontend/src/kit/dialogAct.ts`, a Konto box, the
  one-shot form, or a press wrapped in the hook itself, as
  `fl_frontend/src/app/admin/(editor)/schiedsrichter/[schiedsrichter]/SchiedsrichterEditor.tsx`
  wraps its save and `fl_frontend/src/app/admin/(list)/address-changes/ChangeActs.tsx` its row's
  resend (the hook is `fl_frontend/src/kit/usePasskeyTouch.ts`): every input is typed before the
  touch's session starts its `PASSKEY_TOUCH_SECONDS`, and a touch fired from an effect asks a prompt
  nobody pressed for, on a remount or a re-render as well.
- An act behind the touch whose typed input the server judges takes a `run` its lane declares
  `dryRun: true` (`fl_frontend/src/core/action.ts`), over a backend `dry_run` judged by the write's
  own code path (`fl_backend/app/core/routing.py :: DryRun`); `DialogAct`'s `touch` type demands
  one, and a Konto box or an editor's save holding such input takes one as well. The one-shot form
  sends no dry run today, so a touched one with typed input first extends
  `fl_frontend/src/kit/OneShot.tsx :: OneShotForm` to take a `DryRunAction` and press it with
  `{ dryRunFirst: true }`. The press sends the dry run first, through the hook, and a refusal stands
  on its field with the input kept; only an accepted input asks the touch, a dialog stepping aside
  for the prompt and standing again for the write's answer. The lane's body hands its `dryRun` to
  the backend call and skips every effect of its own on it, save one taking access away from an
  address its refusal shows has already lost it, as
  `fl_frontend/src/app/admin/(list)/ban-list/banActs.ts :: enterBan` ends a listed address's
  sessions before it refuses: a backend write sent on a dry run is refused before it leaves
  (`fl_frontend/src/core/requestScope.ts :: recordWriteSent`), so a body ignoring `dryRun` fails
  every press on the shared failure line, and an effect outside the generated client, a sign-out or
  a mail, runs before any touch is asked; `tsc` passes either way. An act with no typed input takes
  none, as its refusal has no field to stand on and no input to keep: a question, the erasure page's
  one-shot form, Konto's passkey set-up and the re-send of an address change.
- WebKit dropped WebAuthn's user-gesture requirement in Safari 17.4, on whichever macOS runs it, and
  in iOS and iPadOS 17.4, where every browser runs WebKit (271656@main). Apple's developer forums,
  thread 747036, name macOS 14.4, the Sonoma release that ships Safari 17.4, and the Safari 17.4
  release notes list that one release for Sonoma, Ventura and Monterey. Below Safari 17.4, and below
  iOS and iPadOS 17.4, WebKit may lose any touched prompt, above all one a dry run puts a request
  before, though it may allow the first prompt after each page load; the loss reads as a closed
  passkey sheet, which says nothing. The owner does not support those versions for any touched act,
  on Konto and the public erasure page as in the administration. A lost prompt in Safari 17.4 or
  later on any macOS, or on iOS or iPadOS 17.4 or later, is a bug to reproduce, not an unsupported
  browser. `tsc` and every unit test pass either way, and the passkey journeys run in Chromium
  alone.
- A journey presses a control inside an overlay through the overlay a helper of
  `fl_frontend/e2e/support/controls.ts` answered, never by the control's own role off the page, a
  button's or a text box's, which the lint's ban on looking up an overlay's role passes. Found that
  way, the press can land on an overlay still entering: it fails Playwright's stability check, and
  the retry scrolls the control into view, which closes a rising sheet or a combo box's list, and
  only a journeys leg in CI shows it, now and then.
- Grep for render props before deleting a `"use client"`. A Server Component may not pass a function
  to a Client Component, and neither `tsc` nor the build catches it on a dynamic route.
