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
- An act behind the passkey touch asks it from its final press alone, so every input is typed before
  the touch's minute starts: through the `touch` slot of `fl_frontend/src/kit/ConfirmDialog.tsx` or
  `fl_frontend/src/kit/dialogAct.ts`, a Konto box, the one-shot form, or an editor's save wrapped in
  the hook itself, as
  `fl_frontend/src/app/admin/(editor)/schiedsrichter/[schiedsrichter]/SchiedsrichterEditor.tsx`
  wraps its save (the hook is `fl_frontend/src/kit/usePasskeyTouch.ts`). A new touched form act
  needs a backend dry run judged by the write's own code path, which its dialog's press sends before
  the prompt, so the touch is asked only of an input the server has accepted. Safari dropped
  WebAuthn's user-gesture requirement in iOS 17.4 and macOS 14.4 (WebKit 271656@main). An older
  Safari loses a prompt asked after the dry run's round trip, though it may still allow the first
  prompt after each page load, and the loss reads as a closed passkey sheet, which says nothing. The
  owner does not support those versions for any touched act, on Konto and the public erasure page as
  in the administration. `tsc` and every unit test pass either way, and the passkey journeys run in
  Chromium alone.
- A journey presses a control inside an overlay through the overlay a helper of
  `fl_frontend/e2e/support/controls.ts` answered, never by the control's own role off the page, a
  button's or a text box's, which the lint's ban on looking up an overlay's role passes. Found that
  way, the press can land on an overlay still entering: it fails Playwright's stability check, and
  the retry scrolls the control into view, which closes a rising sheet or a combo box's list, and
  only a journeys leg in CI shows it, now and then.
- Grep for render props before deleting a `"use client"`. A Server Component may not pass a function
  to a Client Component, and neither `tsc` nor the build catches it on a dynamic route.
