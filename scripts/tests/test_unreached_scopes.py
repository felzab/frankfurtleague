"""SCRIPTS · a scope the run announced and then never opened, executed rather than read.

`scripts/gate/verify.sh` names every selected scope before anything runs, and an ending reached partway
through leaves the rest with no section and no row. Each case below runs the shell, because the
absence this guards against is one no comparison of literals can see.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Final

SCRIPTS: Final = Path(__file__).resolve().parent.parent
LIB: Final = SCRIPTS / "lib" / "_lib.sh"
VERIFY: Final = SCRIPTS / "gate" / "verify.sh"

# Not a skip condition, for `test_exit_contract.py`'s reason: a machine with no bash cannot run the
# gate at all, and a guard silently skipped is the state this file exists to catch.
BASH: Final = shutil.which("bash")


def _run(body: tuple[str, ...], env_extra: dict[str, str] | None = None) -> tuple[int, str]:
    """Source `_lib.sh` in a throwaway script, run one body, and answer its status beside its output."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    # A parent's own run state would decide the answer: FL_GATE_WORKER silences every summary.
    env = {name: value for name, value in os.environ.items() if not name.startswith("FL_GATE_")}
    env.pop("GITHUB_ACTIONS", None)
    env.pop("VERBOSE", None)
    env["FL_GATE_COLOR"] = "0"
    env["NO_SPINNER"] = "1"
    env.update(env_extra or {})
    with tempfile.TemporaryDirectory() as scratch:
        fixture = Path(scratch) / "run.sh"
        # `newline=""` because a CRLF fixture leaves bash a stray return on every line.
        with fixture.open("w", encoding="utf-8", newline="") as handle:
            handle.write("\n".join(("#!/usr/bin/env bash", f'source "{LIB.as_posix()}"', *body, "")))
        done = subprocess.run(
            (BASH, fixture.as_posix()),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            check=False,
        )
    return done.returncode, done.stdout + done.stderr


def _row(output: str, scope: str) -> str | None:
    """What the closing table says about one scope, or None where it holds no row for it."""
    # Two spaces at least: the table's own column gap, which the not-run line's `not run: gamma`
    # does not have, so a scope named only there is correctly read as having no row.
    found = re.search(rf"^ +{re.escape(scope)} {{2,}}(\S.*?)\s*$", output, re.MULTILINE)
    return None if found is None else found.group(1)


def test_a_selected_scope_the_run_never_opened_is_named_in_the_closing_table() -> None:
    """The reporting hole itself: announced as covered, never run, and named nowhere afterwards."""
    code, output = _run(("set_selected 'alpha beta'", "section alpha", 'die "stopped here"'))
    assert code == 1, f"the finding that stopped the run exited {code}"
    row = _row(output, "beta")
    assert row is not None, f"the beta scope has no row, and nothing else names it:\n{output}"
    assert row.startswith("unreached"), f"the beta row reads {row!r}"


def test_the_three_states_a_scope_can_be_in_read_apart() -> None:
    """Not selected, selected and never reached, and run to a verdict: one reading each."""
    body = ("set_not_run ' gamma'", "set_selected 'alpha beta'", "section alpha", 'die "stopped here"')
    code, output = _run(body)
    assert code == 1
    assert "not run: gamma" in output, output
    assert _row(output, "gamma") is None, "a scope nobody selected took a row in the table"
    ran, unreached = _row(output, "alpha"), _row(output, "beta")
    assert ran is not None and ran.startswith("failed"), f"the alpha row reads {ran!r}"
    assert unreached is not None and unreached.startswith("unreached"), f"the beta row reads {unreached!r}"


def test_a_run_that_reached_every_scope_reports_none_unreached() -> None:
    """The new state has to be invisible on a run that covered everything it announced."""
    code, output = _run(("set_selected 'alpha'", "section alpha", 'ok "checked"', "finish"))
    assert code == 0, output
    assert "unreached" not in output, output


def test_the_last_selected_scope_dying_leaves_nothing_unreached() -> None:
    """Every announced scope opened, so the run stopped short of none of them."""
    body = ("set_selected 'alpha beta'", "section alpha", 'ok "checked"', "section beta", 'die "stopped here"')
    code, output = _run(body)
    assert code == 1
    assert "unreached" not in output, output


def test_a_refusal_still_reads_as_a_refusal_over_an_unreached_scope() -> None:
    """Reporting, not grading: a row is added and the ending it was added to is untouched."""
    code, output = _run(("set_selected 'alpha beta'", "section alpha", 'refuse "the input could not be judged"'))
    assert code == 2, f"a refusal exited {code}"
    assert "Refused after" in output, output
    row = _row(output, "beta")
    assert row is not None and row.startswith("unreached"), f"the beta row reads {row!r}"


def test_a_worker_handed_a_selected_list_still_summarises_nothing() -> None:
    """The parent prints the table once, over bytes it replays; a worker printing one duplicates it."""
    body = ("set_selected 'alpha beta'", "section alpha", 'die "stopped here"')
    code, output = _run(body, {"FL_GATE_WORKER": "1"})
    assert code == 1
    assert "unreached" not in output, output


def test_an_unreached_scope_does_not_reach_the_status_a_workers_rows_are_held_to() -> None:
    """`adopt_ending` cross-validates a worker's status against its rows, and this adds no row."""
    body = ("set_selected 'alpha beta'", "adopt_section alpha 2 10 0 0", "adopt_ending 1")
    code, output = _run(body)
    assert code == 3, f"a status its rows contradict exited {code}"
    assert "carries no finding" in output, output


def test_a_scope_after_the_one_that_crashed_the_parallel_replay_is_named() -> None:
    """`replay_scope` exits inside `adopt_ending`, so the scopes behind it never have rows adopted."""
    body = ("set_selected 'alpha beta'", "adopt_section alpha 2 10 0 0", "adopt_ending 4")
    code, output = _run(body)
    assert code == 4, f"a crashed worker exited {code}"
    assert "Crashed after" in output, output
    row = _row(output, "beta")
    assert row is not None and row.startswith("unreached"), f"the beta row reads {row!r}"


def test_verify_hands_the_ending_the_scopes_it_announced() -> None:
    """The row needs the selected list, and only the parent knows it."""
    text = VERIFY.read_text(encoding="utf-8")
    assert 'set_selected "$SCOPES_RAN"' in text, "scripts/gate/verify.sh no longer hands over its selected scopes"
    assert 'info "this run covers: ${SCOPES_RAN% }"' in text, "the announcement and the handover no longer read one list"
