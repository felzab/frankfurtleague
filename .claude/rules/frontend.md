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
  (`fl_frontend/src/kit/FieldParts.tsx :: useFieldWait`) and a row in the server-render case of
  `fl_frontend/src/kit/HeldForm.test.tsx`; without it, React's next render writes its state over
  what a person typed or pressed before the page hydrated, and `tsc`, the lint, the build and every
  field's own tests pass. A select's trigger opens nothing before hydration and a read-only field
  takes no input, so neither has a state to lose and neither waits. The wait is `inert`, never
  `disabled`, which drops the field from the posted form, nor `readOnly`, which leaves a caret and
  holds no box or radio. Pages call the kit: React Aria and a raw control are banned outside it.
- An act behind the passkey touch asks it from its final press alone, through the `touch` slot of
  `fl_frontend/src/kit/ConfirmDialog.tsx` or `fl_frontend/src/kit/dialogAct.ts`, a Konto box, the
  one-shot form, or an editor's save wrapped in the hook itself, as
  `fl_frontend/src/app/admin/(editor)/schiedsrichter/[schiedsrichter]/SchiedsrichterEditor.tsx`
  wraps its save (the hook is `fl_frontend/src/kit/usePasskeyTouch.ts`): every input is typed before
  the touch's session starts its `PASSKEY_TOUCH_SECONDS`, and a touch fired from an effect asks a
  prompt nobody pressed for, on a remount or a re-render as well.
- An act behind the touch whose typed input the server judges takes a `run` its lane declares
  `dryRun: true` (`fl_frontend/src/core/action.ts`), over a backend `dry_run` judged by the write's
  own code path (`fl_backend/app/core/routing.py :: DryRun`); `DialogAct`'s `touch` type demands
  one, and a Konto box or an editor's save holding such input takes one as well. The press sends the
  dry run first, through the hook, and a refusal stands on its field with the input kept; only an
  accepted input asks the touch, a dialog stepping aside for the prompt and standing again for the
  write's answer. The lane's body hands its `dryRun` to the backend call and skips every effect of
  its own on it: a body ignoring it writes before any touch is asked, and `tsc` passes. An act with
  no typed input takes none, as its refusal has no field to stand on and no input to keep: a
  question, the one-shot form, Konto's passkey set-up and the re-send of an address change.
- WebKit dropped WebAuthn's user-gesture requirement in Safari 17.4, on every macOS it ships for,
  and in iOS and iPadOS 17.4, where every browser runs WebKit (271656@main). An older WebKit may
  lose any touched prompt, above all one a dry run puts a request before, though it may allow the
  first prompt after each page load; the loss reads as a closed passkey sheet, which says nothing.
  The owner does not support those versions for any touched act, on Konto and the public erasure
  page as in the administration. `tsc` and every unit test pass either way, and the passkey journeys
  run in Chromium alone.
- A journey presses a control inside an overlay through the overlay a helper of
  `fl_frontend/e2e/support/controls.ts` answered, never by the control's own role off the page, a
  button's or a text box's, which the lint's ban on looking up an overlay's role passes. Found that
  way, the press can land on an overlay still entering: it fails Playwright's stability check, and
  the retry scrolls the control into view, which closes a rising sheet or a combo box's list, and
  only a journeys leg in CI shows it, now and then.
- Grep for render props before deleting a `"use client"`. A Server Component may not pass a function
  to a Client Component, and neither `tsc` nor the build catches it on a dynamic route.
