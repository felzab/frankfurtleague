"""SCRIPTS · the frontend unit tests' shards: the CI matrix counts its shards, and the gate refuses a shard it cannot place.

A shard runs the files `node --test` hands it and no others, so a count typed by hand beside the
matrix can name shards no instance runs, their files in none while every instance is green. The
refusals are driven through the real `scripts/gate/verify.sh` over a copy of `scripts/`.

Invariants:
  A shard the gate cannot place refuses at `docs/ops/spec.md` §1.7's exit 2, never at 1.
"""

from __future__ import annotations

import functools
import re
from pathlib import Path
from typing import Final

from conftest import BASH, REPO_ROOT, base_env, copy_scripts, new_root, run_shell
from test_check_gate_budget import AXIS_RE, MATRIX_RE, job_bodies
from test_gate_prerequisites import PAST_THE_GUARD

WORKFLOW: Final = REPO_ROOT / ".github" / "workflows" / "verify.yml"
SHARD_JOB: Final = "frontend-units"
SHARD_RE: Final = re.compile(r"^\s*VERIFY_TEST_SHARD:\s*(.+?)\s*$", re.MULTILINE)
# The index is the instance's own, and the count is the matrix's size rather than a second copy of it.
DERIVED_SPEC: Final = "${{ matrix.shard }}/${{ strategy.job-total }}"

# The mark `scripts/lib/_lib.sh :: refuse` prints its reason under. Without it a reason printed as a
# notice, with the run refusing later for something else, reads the same. Built, as a code point.
REFUSED: Final = chr(0x2717) + "  "


def test_every_shard_is_counted_by_the_matrix() -> None:
    """What the job's rows cannot see: a typed count, a second axis or an `include` leaves shards unrun or run twice.

    Each keeps the instances' names, so the rows still match them.
    """
    workflow = WORKFLOW.read_text(encoding="utf-8")
    body = job_bodies(workflow).get(SHARD_JOB)
    assert body is not None, f"no `{SHARD_JOB}` job, so nothing is known to run the unit tests at all"
    matrix = MATRIX_RE.search(body)
    lines = [] if matrix is None else matrix[1].splitlines()
    axes = [axis[1] for line in lines if (axis := AXIS_RE.match(line)) is not None]
    assert axes == ["shard"] and len(lines) == 1, f"the matrix holds {lines!r}, where the `shard` list alone names one instance per shard"
    specs = SHARD_RE.findall(body)
    assert specs == [DERIVED_SPEC], (
        f"the job hands `VERIFY_TEST_SHARD` {specs}, where the one spelling counting every instance is `{DERIVED_SPEC}`"
    )


@functools.cache
def _gate() -> Path:
    """One copy of `scripts/` for every run below, none of which writes to it."""
    root = new_root("fl-gate-shard-")
    copy_scripts(root / "scripts")
    return root / "scripts" / "gate" / "verify.sh"


def _refused(shard: str, *flags: str) -> str:
    """The run's output, once it has refused with exit 2 and reached no scope."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    done = run_shell(BASH, _gate(), *flags, env={**base_env(), "VERIFY_TEST_SHARD": shard})
    output = done.stdout + done.stderr
    assert done.returncode == 2, f"VERIFY_TEST_SHARD={shard} {' '.join(flags)} exited {done.returncode}:\n{output}"
    assert "Refused after" in output, output
    assert PAST_THE_GUARD not in output, output
    return output


# The index at zero, the index past the count, and no count at all.
MALFORMED: Final[tuple[str, ...]] = ("0/4", "5/4", "2")


def test_a_shard_naming_no_shard_is_refused() -> None:
    """Exit 2 rather than 1, for the module's invariant: no change to the tree repairs an argument."""
    missed = [
        shard
        for shard in MALFORMED
        if REFUSED + f"VERIFY_TEST_SHARD is '{shard}', which names no shard" not in _refused(shard, "--frontend-units")
    ]
    assert not missed, "refused without saying the shard names none: " + ", ".join(missed)


# Beside a second scope, and with no scope named, which runs every scope.
BESIDE: Final[tuple[tuple[str, ...], ...]] = (("--frontend-units", "--docs"), ())


def test_a_shard_beside_another_scope_is_refused() -> None:
    """A shard beside a second scope would close its run reading as the whole suite proven."""
    missed = [
        " ".join(flags) or "no scope named"
        for flags in BESIDE
        if REFUSED + "VERIFY_TEST_SHARD is set, and a shard is taken only by --frontend-units run alone" not in _refused("1/4", *flags)
    ]
    assert not missed, "refused without saying a shard runs alone: " + ", ".join(missed)
