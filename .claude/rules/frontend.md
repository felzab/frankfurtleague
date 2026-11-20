---
paths:
  - "fl_frontend/**/*"
  - "fl_frontend/**/.*"
---

# Traps — the frontend surface

Each fails silently. The ratified decisions for this surface are in `docs/decisions.md`.

- A page whose address holds a token never forwards it into another address and never loads a
  third-party script with it in the address: one that must do either joins the proxy's mailed-link
  table (`fl_frontend/src/core/mailedLink.ts :: MAILED_LINK_PAGES`), which moves the token into a
  cookie before the page renders. Turnstile's script hands the whole address to Cloudflare's frame,
  and a sign-in's return address travels through every page of the sign-in.
- Every kit field's root takes `inert={useFieldWait()}`
  (`fl_frontend/src/kit/FieldParts.tsx :: useFieldWait`) and a row in the server-render case of
  `fl_frontend/src/kit/HeldForm.test.tsx`; without it, React's next render writes its state over
  what a person typed or pressed before the page hydrated, and `tsc`, the lint, the build and every
  field's own tests pass. The wait is `inert`, never `disabled`, which drops the field from the
  posted form, nor `readOnly`, which leaves a caret and holds no box or radio. Pages call the kit:
  React Aria and a raw control are banned outside it.
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
