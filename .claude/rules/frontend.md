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
- What a person did to a server-drawn field before the page hydrated is never lost. A kit field on a
  native `input` or `textarea` puts `fl_frontend/src/kit/useEarlyEdit.ts :: useEarlyEdit`'s ref on its
  root and takes a row in `fl_frontend/src/kit/useEarlyEdit.test.tsx`; without it, React's next render
  writes its state over the edit and `tsc`, the build and every field's own tests pass. The lint's
  list of React Aria's field modules names the files that have done so. A control the hook cannot
  reach holds nothing to lose only if the server's markup takes no edit until the page's code runs:
  a `textarea` holding text stands `readOnly` (`fl_frontend/src/kit/TextField.tsx :: ParagraphBox`),
  since React writes that text back while hydrating, before any effect reads the edit; a
  `contenteditable` control stands `inert` (`fl_frontend/src/kit/dateParts.tsx :: Segments`, which the
  lint keeps React Aria's date segments in), since a changed text fails hydration, and React renders
  anew in the browser from the nearest Suspense boundary, the whole page where none stands, as none
  does in the tree, discarding every edit there. Pages call the kit: React Aria and a raw control
  are banned outside it.
- An act behind the passkey touch asks it from its final press alone, through the `touch` slot of
  `fl_frontend/src/kit/ConfirmDialog.tsx` or `fl_frontend/src/kit/dialogAct.ts`, a Konto box or the
  one-shot form (`fl_frontend/src/kit/usePasskeyTouch.ts`). A touch fired from an effect, or behind
  anything slower than the sign-in client's own request, has lost the press Safari asks of WebAuthn:
  `tsc` and every unit test pass, and the passkey journeys run in Chromium alone.
- Grep for render props before deleting a `"use client"`. A Server Component may not pass a function
  to a Client Component, and neither `tsc` nor the build catches it on a dynamic route.
