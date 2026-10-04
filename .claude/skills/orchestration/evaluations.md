# Orchestration skill — evaluations

Run these before and after any change to the skill, the agent definitions or the compaction hook,
and compare each scenario's outcome across the arms. A change that no scenario can tell apart from
its baseline is not yet shown to help.

## How to run

- **One fresh top-level session per run**, `claude -p` or interactive for the compaction case, in a
  throwaway clone or a fixture repository. A subagent cannot run one: the spawn depth of 1 stops it
  coordinating agents of its own.
- **The model the owner pins for subagents**, through `CLAUDE_CODE_SUBAGENT_MODEL`, unchanged.
- **Three arms:** the skill on; the skill off, through `skillOverrides: {"orchestration": "off"}`
  in the fixture's `.claude/settings.local.json`; and the previous layout against the new one.
- **Grading:** a `cold-auditor` reads each transcript against the scenario's expected behaviour,
  beside mechanical checks of `git log`, `git worktree list` and the register.
- **Compaction early:** `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` set low brings a compaction inside a short
  run. Its effect on a main session is assumed from the documentation, not yet observed.

## Scenarios

| #   | Scenario            | Fixture                                                                                                                                                                 | Expected behaviour                                                                                                                                                                                                         | Baseline expectation                                               |
| --- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| E1  | Planning            | Six work items: two write one shared file; two share an exit-code contract across different files                                                                       | The register exists before the first dispatch; the shared file has one owner or a region split named in both briefs; the coupled pair shares a wave; the commit table is filled; the owner's questions go out as one batch | Work dispatched by task, with a collision on the shared file       |
| E2  | Compaction mid-wave | A register with a resume point and two live agents; a compaction forced                                                                                                 | The next action matches the resume point; no agent dispatched twice; the core present whole after the summary, with no truncation marker                                                                                   | The next action taken from the summary rather than the register    |
| E3  | Quota-stop resume   | The session killed while one agent branch holds commits and its worktree an uncommitted file; then `/orchestration resume`                                              | The register found without asking; worktrees matched to its table; only evidenced commits landed; the uncommitted work saved to the scratch path; a successor briefed from the saved brief and its messages file           | The owner asked for the register's path; the uncommitted file lost |
| E4  | Landing             | Two finished agent branches: one whose commit body claims more than its diff, one conflicting with the session branch in a markdown table                               | Each body read against `git diff HEAD...<branch>` before its merge, the false one sent back; the table conflict merged by row key or sent back to the agent; no row dropped in silence                                     | A body landed unread                                               |
| E5  | Judging a report    | A report carrying a wrong count, an unsourced premise and an out-of-scope finding                                                                                       | The count checked against the agent's branch; one ledger row per `F<n>`; each finding routed at its class; the fix brief calls the finding a claim                                                                         | The report's count repeated as fact                                |
| E6  | Triggering          | Five prompts that should load the skill ("resume the fleet after the quota stop", "plan this three-session programme", …) and five that should not ("fix this typo", …) | The skill loads for the first five and for none of the second                                                                                                                                                              | —                                                                  |
| E7  | The ending          | A session whose last wave has landed                                                                                                                                    | The last wave's audit and its fix; the enumeration re-run; the full gate; the draft pull request's body replaced; the handoff written once from the register and audited by an agent that saw none of the work             | The handoff written before the last fix landed                     |

## Recording a run

Record per run: the arm, the model, the scenario, the grader's verdict on each expected behaviour,
and the mechanical checks' output. A scenario passes in an arm when every expected behaviour holds;
compare arms by scenario, never by a total.
