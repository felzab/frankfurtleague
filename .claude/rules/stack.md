---
paths:
  - "fl_frontend/**/*"
  - "fl_frontend/**/.*"
  - "fl_backend/**/*"
  - "fl_backend/**/.*"
  - "scripts/**/*"
  - "scripts/**/.*"
  - "nginx/**/*"
  - "nginx/**/.*"
  - ".github/**/*"
  - ".github/**/.*"
  - "docker-compose*.yml"
---

# The stack's documentation, and what it will not catch

`.claude/CLAUDE.md` §4's sources: grep a package's `llms.txt` before answering about its API or
writing a line that depends on it.

| Package                 | Index                                                                               | Full text                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Next.js**             | [docs/llms.txt](https://nextjs.org/docs/llms.txt)                                   | [docs/llms-full.txt](https://nextjs.org/docs/llms-full.txt)                |
| **React Aria**          | [llms.txt](https://react-aria.adobe.com/llms.txt)                                   | — (index only)                                                             |
| **shadcn/ui**           | [llms.txt](https://ui.shadcn.com/llms.txt)                                          | — (index only)                                                             |
| **HeroUI**              | [react/llms.txt](https://heroui.com/react/llms.txt)                                 | [react/llms-full.txt](https://heroui.com/react/llms-full.txt)              |
| **Vitest**              | [llms.txt](https://vitest.dev/llms.txt)                                             | [llms-full.txt](https://vitest.dev/llms-full.txt)                          |
| **Pydantic**            | [llms.txt](https://pydantic.dev/docs/validation/latest/llms.txt)                    | [llms-full.txt](https://pydantic.dev/docs/validation/latest/llms-full.txt) |
| **Zod**                 | [llms.txt](https://zod.dev/llms.txt)                                                | [llms-full.txt](https://zod.dev/llms-full.txt)                             |
| **React**               | [llms.txt](https://react.dev/llms.txt)                                              | — (index only)                                                             |
| **Resend**              | [docs/llms.txt](https://resend.com/docs/llms.txt)                                   | — (index only)                                                             |
| **Better Auth**         | [docs/llms.txt](https://better-auth.com/docs/llms.txt)                              | — (index only)                                                             |
| **MongoDB Node driver** | [node/current/llms.txt](https://www.mongodb.com/docs/drivers/node/current/llms.txt) | — (index only)                                                             |
| **Docker**              | [llms.txt](https://docs.docker.com/llms.txt)                                        | [llms-full.txt](https://docs.docker.com/llms-full.txt)                     |
| **GitHub**              | [llms.txt](https://docs.github.com/llms.txt)                                        | — (index only)                                                             |
| **Prettier**            | [llms.txt](https://prettier.io/llms.txt)                                            | [llms-full.txt](https://prettier.io/llms-full.txt)                         |
| **Ruff**                | [ruff/llms.txt](https://docs.astral.sh/ruff/llms.txt)                               | — (index only)                                                             |
| **uv**                  | [uv/llms.txt](https://docs.astral.sh/uv/llms.txt)                                   | — (index only)                                                             |

- **Next.js ships its docs inside the installed package**, at
  `fl_frontend/node_modules/next/dist/docs/`, matched to the version that runs: grep them first, and
  the `llms.txt` above only where they are silent, since it tracks the newest release.
- A reference is authoritative only while it is official and current — the project's own domain,
  with the installed version in it as a documented release. Where either fails, use the prose docs
  plus the installed typings in `node_modules`, and say which you used. For HeroUI use the `react/`
  URLs, never the bare `heroui.com/llms-full.txt`, which merges in HeroUI Native.
- Tailwind, FastAPI and Playwright publish none, and PyMongo's is a topic index of unconfirmed
  conformance, so their prose docs stay authoritative: [Tailwind](https://tailwindcss.com/docs) ·
  [FastAPI](https://fastapi.tiangolo.com) · [Playwright](https://playwright.dev/docs/intro) ·
  [PyMongo](https://www.mongodb.com/docs/languages/python/pymongo-driver/current/). For a package
  missing from this table, probe `<docs-root>/llms.txt` and add the row when one turns up.

## Deprecations the toolchain will NOT catch

These compile, pass, and silently do nothing:

| Never                                   | Always                               |
| --------------------------------------- | ------------------------------------ |
| `middleware.ts`                         | `proxy.ts`                           |
| `tailwind.config.js`                    | CSS-first `@theme` / `@layer`        |
| `@tailwind base/components/utilities`   | `@import "tailwindcss"`              |
| `getServerSideProps` / `getStaticProps` | Server Components + `use cache`      |
| A direct DB query for application data  | FastAPI (the sign-in store excepted) |
