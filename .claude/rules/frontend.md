---
paths:
  - "fl_frontend/**/*"
  - "fl_frontend/**/.*"
---

# Traps — the frontend surface

Each fails silently. The ratified decisions for this surface are in `docs/decisions.md`.

- Every page whose address carries a token is in the proxy's mailed-link table
  (`fl_frontend/src/core/mailedLink.ts :: MAILED_LINK_PAGES`), which moves the token into a cookie
  before the page renders, so no history entry, referrer or third-party script receives it. A new
  such page is made under `/confirm/`, where nginx's prefix already meters it, and joins the table.
- Every kit field a person types into or toggles takes `inert={useFieldWait()}` at its root
  (`fl_frontend/src/kit/FieldParts.tsx :: useFieldWait`) and a row in the server-render case of
  `fl_frontend/src/kit/HeldForm.test.tsx`; without it, React's next render writes its state over
  what a person typed or pressed before the page hydrated, and `tsc`, the lint, the build and every
  field's own tests pass. A select's trigger opens nothing before hydration and a read-only field
  takes no input, so neither has a state to lose and neither waits. The wait is `inert`, never
  `disabled`, which drops the field from the posted form, nor `readOnly`, which leaves a caret and
  holds no box or radio. Pages call the kit: React Aria and a raw control are banned outside it.
- An act behind the passkey touch asks it from its final press alone, through the `touch` slot of
  `fl_frontend/src/kit/ConfirmDialog.tsx` or `fl_frontend/src/kit/dialogAct.ts`, a Konto box or the
  one-shot form (`fl_frontend/src/kit/usePasskeyTouch.ts`). A touch fired from an effect, or behind
  anything slower than the sign-in client's own request, has lost the press Safari asks of WebAuthn:
  `tsc` and every unit test pass, and the passkey journeys run in Chromium alone.
- A journey presses a control inside an overlay through the overlay a helper of
  `fl_frontend/e2e/support/controls.ts` answered, never by the control's own role off the page, a
  button's or a text box's, which the lint's ban on looking up an overlay's role passes. Found that
  way, the press can land on an overlay still entering: it fails Playwright's stability check, and
  the retry scrolls the control into view, which closes a rising sheet or a combo box's list, and
  only a journeys leg in CI shows it, now and then.
- Grep for render props before deleting a `"use client"`. A Server Component may not pass a function
  to a Client Component, and neither `tsc` nor the build catches it on a dynamic route.
