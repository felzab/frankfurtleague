---
paths:
  - "fl_frontend/**/*"
  - "fl_frontend/**/.*"
---

# Traps — the frontend surface

Each fails silently. The ratified decisions for this surface are in `docs/decisions.md`.

<!-- Session 8: the HeroUI trap below goes with HeroUI's last stylesheet import. -->

- A HeroUI component a page not yet rebuilt imports needs its stylesheet imported into
  `fl_frontend/src/app/globals.css`, which loads on every route, at the position it holds in
  `node_modules/@heroui/styles/dist/components/index.css`, and so does every part it renders beneath
  it: a popover, a listbox, a button. Without it the component renders unstyled while `tsc`,
  `next build` and ESLint all pass.
- Grep for render props before deleting a `"use client"`. A Server Component may not pass a function
  to a Client Component, and neither `tsc` nor the build catches it on a dynamic route.
- Declare a granular cache tag with `invalidatesOnWrite` in every action writing its resource, in the
  same change as the tag; a tag nothing invalidates is decoration.
