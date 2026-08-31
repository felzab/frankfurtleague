# Auditing

**Folder purpose:** how this repository is audited — the method a programme runs by, the prompts each
pass reads, and the report every finished programme leaves behind.

## Folder overview

| Read                                                   | For                                                                                     |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| [`programme.md`](programme.md)                         | The method — read it before any `/audit:*` command: lifecycle, artifacts, session rules |
| [`lessons.md`](lessons.md)                             | Traps and failure modes to check before running anything                                |
| [`ledger-template.md`](ledger-template.md)             | Skeleton for the remediation ledger                                                     |
| [`final-report-template.md`](final-report-template.md) | Skeleton for the report a programme closes with                                         |
| [`prompts/`](prompts/)                                 | One prompt per pass, plus the shared protocol                                           |

## Where an audit's own documents live

Everything an audit produces is written under `docs/audit/`, which is gitignored so that an
unremediated finding never publishes:

```
docs/audit/
├── register.md                       the standing failure-mode register
├── programme/                        the current programme — reports, ledger, wave reports
└── documentation-<yyyy-mm-dd>.md     a /docs:audit sweep report, beside programme/ and never inside it
```

`programme/` is deleted at close; everything beside it survives.
