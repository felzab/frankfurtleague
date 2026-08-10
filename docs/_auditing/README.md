# Auditing

**Folder purpose:** how this repository is audited — the method a programme runs by, the prompts each
pass reads, and the permanent report every finished programme leaves behind.

## Folder overview

| Read                                                   | For                                                               |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| [`programme.md`](programme.md)                         | The method: lifecycle, artifacts, session rules, close-out        |
| [`lessons.md`](lessons.md)                             | Traps and failure modes to check before running anything          |
| [`ledger-template.md`](ledger-template.md)             | Skeleton for the remediation ledger                               |
| [`final-report-template.md`](final-report-template.md) | Skeleton for the permanent report                                 |
| [`prompts/`](prompts/)                                 | One prompt per pass, plus the shared protocol and the wave prompt |
| [`reports/`](reports/)                                 | Final reports of completed programmes. Permanent.                 |

## Where the working documents live

Everything an audit produces except the final report is written under `docs/audit/`, which is
gitignored — the repository is public, and an unremediated finding must not publish:

```
docs/audit/
├── register.md                       the standing failure-mode register — survives every close
├── programme/                        the current programme — reports, ledger, wave reports
└── documentation-<yyyy-mm-dd>.md     a /docs:audit sweep report, beside programme/ and never inside it
```

`programme/` is deleted at close. `register.md` and any sweep report sit outside it and survive.

## Read next

- [`programme.md`](programme.md) — start here before running any `/audit:*` command
- [`../_standard/`](../_standard/) — the standard `/docs:audit` reads a document against
