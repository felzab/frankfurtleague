"""SCRIPTS · what `scripts/ops/deploy.sh` copies and reads before a container is replaced.

`--force-recreate` discards a container's `json-file` stream and a failed deploy recreates the
application pair twice, so `:: copy_streams` runs on both paths -- refusing where nothing has been
recreated yet, and warning inside `:: roll_back`, where the site is already down and a log file is
not worth leaving it there. `:: check_env_names` is the other read taken before the recreate: the
environment file is a file to the settings class only there, and everything it prints is names.
Both are lifted out of the script and driven behind a stand-in `docker`, so no daemon and no compose
file of this machine; the snippet that reader hands the image is run for real instead, because a stub
records an argv and answers nothing about what the image does.

Invariants:
  Nothing here reads or writes a real environment file: the fixture builds its own, of dummy names.
  Every case runs from the fixture's checkout: `_lib.sh` cd's to this repository on source.
"""

from __future__ import annotations

import os
import re
import shutil
from pathlib import Path
from typing import Final

from conftest import base_env, lift_function, new_root, run_shell, write_shell

SCRIPTS: Final = Path(__file__).resolve().parent.parent
REPO_ROOT: Final = SCRIPTS.parent
LIB: Final = SCRIPTS / "lib" / "_lib.sh"
DEPLOY: Final = SCRIPTS / "ops" / "deploy.sh"
RUNBOOKS: Final = REPO_ROOT / "docs" / "ops" / "runbooks.md"
BACKEND_DOCKERFILE: Final = REPO_ROOT / "fl_backend" / "Dockerfile"

# Not a skip condition, for `scripts/tests/test_exit_contract.py :: BASH`'s reason.
BASH: Final = shutil.which("bash")

STAMP: Final = "2026-09-07T101500"

# `ps` and `logs` are steered by a service-name list in the environment; `run` records the argv it
# was handed, which is the whole of what the mount and the user are asserted from.
STUB: Final = """#!/usr/bin/env bash
set -u
last=""
for arg in "$@"; do last="$arg"; done
if [[ "${1:-}" == "compose" ]]; then
  case " $* " in
    *" ps "*)
      case ":${FL_DEPLOY_NO_CONTAINER:-}:" in *":${last}:"*) exit 0 ;; esac
      printf 'cid-%s\\n' "$last"; exit 0 ;;
    *" logs "*)
      case ":${FL_DEPLOY_LOGS_FAIL:-}:" in *":${last}:"*) exit "${FL_DEPLOY_LOGS_RC:-1}" ;; esac
      printf '%s line one\\n%s line two\\n' "$last" "$last"; exit 0 ;;
  esac
  exit 0
fi
if [[ "${1:-}" == "run" ]]; then
  printf '%s\\n' "$@" > "${FL_DEPLOY_ARGV}"
  if [[ -n "${FL_DEPLOY_RUN_SAYS:-}" ]]; then printf '%s\\n' "${FL_DEPLOY_RUN_SAYS}" >&2; fi
  exit "${FL_DEPLOY_RUN_RC:-0}"
fi
exit 0
"""


def _lifted(name: str) -> str:
    return lift_function(DEPLOY, name)


def _assignment(name: str) -> str:
    """One single-quoted multi-line assignment out of the script, delimiter to delimiter.

    Read rather than restated: a copy here would pass while the script's own regressed.
    """
    text = DEPLOY.read_text(encoding="utf-8")
    opened = text.find(f"\n{name}='")
    assert opened >= 0, f"scripts/ops/deploy.sh assigns no {name} as a single-quoted block"
    closed = text.index("\n'\n", opened + 1)
    return text[opened + 1 : closed + 2]


class _Fixture:
    """The temporary checkout one case drives the lifted functions inside."""

    def __init__(self) -> None:
        self.root = new_root("fl-deploy-streams-")
        self.logs = self.root / "logs"
        self.logs.mkdir(parents=True)
        self.checkout = self.root / "checkout" / "fl_backend"
        self.checkout.mkdir(parents=True)
        # The fixture's own environment file, of names nothing declares: every assertion below reads
        # the arguments the mount was built from, and none reads a file.
        (self.checkout / ".env").write_bytes(b"A_NAME_NOTHING_DECLARES=a value no case reads\n")
        self.argv = self.root / "argv.txt"


def _run(body: str, **overrides: str) -> tuple[int, str, _Fixture]:
    """`_lib.sh`, the lifted readers and a stand-in `docker`, run from a checkout of the fixture's own."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    fixture = _Fixture()
    stubs = fixture.root / "stubs"
    stubs.mkdir()
    # The execute bit is what puts this ahead of a real daemon on PATH.
    os.chmod(write_shell(stubs / "docker", STUB), 0o755)
    environment = base_env()
    environment["PATH"] = str(stubs) + os.pathsep + environment["PATH"]
    environment["FL_DEPLOY_ARGV"] = str(fixture.argv)
    environment.update(overrides)
    script = fixture.root / "parent.sh"
    lines = (
        "#!/usr/bin/env bash",
        f'source "{LIB.as_posix()}"',
        # `_lib.sh` cd's to THIS repository's root as it is sourced, so without this line the
        # fixture's checkout is never entered: `check_env_names` would build its mount from the real
        # tree, and the snippet cases below would read the real `fl_backend/.env`.
        f'cd "{fixture.checkout.parent.as_posix()}"',
        'COMPOSE="docker-compose.yml"',
        f'LOG_DIR="{fixture.logs.as_posix()}"',
        f'LOG_STAMP="{STAMP}"',
        "COPIED_STREAMS=0",
        "ATTEMPTED_STREAMS=0",
        _assignment("ENV_NAME_CHECK"),
        _lifted("service_cid"),
        _lifted("copy_streams"),
        _lifted("check_env_names"),
        body,
        "",
    )
    done = run_shell(BASH, write_shell(script, "\n".join(lines)), env=environment, cwd=fixture.checkout.parent)
    return done.returncode, done.stdout + done.stderr, fixture


def _copies(fixture: _Fixture) -> list[str]:
    return sorted(path.name for path in fixture.logs.iterdir())


# --- the copy taken before each recreate -------------------------------------------------------------

COUNTS: Final = 'printf "copied=%s attempted=%s\\n" "$COPIED_STREAMS" "$ATTEMPTED_STREAMS"'
BEFORE: Final = f'copy_streams "" refuse "NOTHING has been recreated." ; {COUNTS}'
FAILED: Final = f'copy_streams "-failed" warn "The rollback goes on without it." ; {COUNTS}'


def test_the_copy_before_the_recreate_names_one_file_per_running_service() -> None:
    code, output, fixture = _run(BEFORE)

    assert code == 0, output
    assert "copied=2" in output, output
    assert _copies(fixture) == [f"{STAMP}-backend.log", f"{STAMP}-frontend.log"], output


def test_a_service_with_no_container_is_skipped_rather_than_written_empty() -> None:
    """A first deploy has nothing to copy, and an empty file would read as a build that logged nothing."""
    code, output, fixture = _run(BEFORE, FL_DEPLOY_NO_CONTAINER="frontend:backend")

    assert code == 0, output
    assert "copied=0" in output, output
    assert _copies(fixture) == [], output


def test_the_rollbacks_copy_carries_the_suffix_beside_the_same_stamp() -> None:
    """One stamp for the run: a failed deploy leaves four files that sort together, not two pairs a reader has to match up."""
    code, output, fixture = _run(FAILED)

    assert code == 0, output
    assert _copies(fixture) == [f"{STAMP}-backend-failed.log", f"{STAMP}-frontend-failed.log"], output


def test_the_age_sweep_bounds_the_directory_rather_than_a_name_the_suffix_leaves() -> None:
    """The `-failed` names are only bounded while `docs/ops/runbooks.md` §7's tmpfiles line has no glob in it.

    A `*.log` pattern would leave them forever.
    """
    stanza = RUNBOOKS.read_text(encoding="utf-8")
    aged = [line for line in stanza.splitlines() if line.startswith("e /var/log/frankfurtleague")]

    assert aged, "docs/ops/runbooks.md carries no tmpfiles line aging /var/log/frankfurtleague"
    assert "*" not in aged[0], aged[0]
    assert "m:30d" in aged[0], aged[0]


def test_a_copy_that_fails_before_the_recreate_refuses_with_nothing_left_behind() -> None:
    """The `.partial` is the load-bearing half: a short file left in place reads as the build's whole stream."""
    code, output, fixture = _run(BEFORE, FL_DEPLOY_LOGS_FAIL="backend", FL_DEPLOY_LOGS_RC="7")

    assert code == 2, output
    assert "NOTHING has been recreated" in output, output
    assert "(exit 7)" in output, output
    assert _copies(fixture) == [f"{STAMP}-frontend.log"], output


def test_the_same_failure_inside_the_rollback_warns_and_copies_the_other_service() -> None:
    """The site is already down by there, so a refusal would trade the outage for a log file."""
    code, output, fixture = _run(FAILED, FL_DEPLOY_LOGS_FAIL="frontend", FL_DEPLOY_LOGS_RC="7")

    assert code == 0, output
    assert "The rollback goes on without it." in output, output
    assert "NOTHING has been recreated" not in output, output
    assert _copies(fixture) == [f"{STAMP}-backend-failed.log"], output


def test_both_copies_failing_inside_the_rollback_leaves_two_attempts_and_no_stream() -> None:
    """Zero copies with two containers that answered is two warnings already printed, not a stack nobody could ask."""
    code, output, fixture = _run(FAILED, FL_DEPLOY_LOGS_FAIL="frontend:backend", FL_DEPLOY_LOGS_RC="7")

    assert code == 0, output
    assert "copied=0 attempted=2" in output, output
    assert _copies(fixture) == [], output


def test_the_rollbacks_zero_copy_summary_reads_the_attempts_and_not_the_copies_alone() -> None:
    """A summary saying nobody answered, printed under two warnings naming a failed copy, contradicts the lines above it."""
    body = lift_function(DEPLOY, "roll_back")
    summary = body[body.index("copy_streams") : body.index("docker tag")]

    assert "COPIED_STREAMS" in summary, summary
    assert "ATTEMPTED_STREAMS" in summary, summary


def test_the_log_copy_is_bounded_so_a_stalled_daemon_cannot_hold_the_outage_open() -> None:
    """The rollback runs this with the site already down, and it is the one command there that waits on the daemon unbounded."""
    call = [line for line in lift_function(DEPLOY, "copy_streams").splitlines() if "logs --no-color" in line and "$partial" in line]

    assert len(call) == 1, call
    assert call[0].strip().startswith("timeout "), call


def test_the_rollback_copies_before_it_re_tags_anything() -> None:
    """The whole of the fix: a copy taken after the re-tag and the recreate is a copy of the build that replaced the failed one."""
    body = lift_function(DEPLOY, "roll_back")
    copied = body.index("copy_streams")
    retagged = body.index("docker tag")

    assert copied < retagged, "scripts/ops/deploy.sh :: roll_back re-tags before it copies the failed build's streams"


def test_the_two_call_sites_differ_in_the_suffix_and_in_the_verb_alone() -> None:
    """The pair is the decision: a refusal where nothing has been recreated, an advisory where the site is already down.

    The rollback's call comes first in the file.
    """
    calls = re.findall(r"^\s*copy_streams (\"[^\"]*\") (\w+) ", DEPLOY.read_text(encoding="utf-8"), re.MULTILINE)

    assert calls == [('"-failed"', "warn"), ('""', "refuse")], calls


# --- the environment file, read by the build about to run --------------------------------------------

NAMES: Final = "check_env_names"


def test_a_name_the_backend_does_not_declare_refuses_with_nothing_recreated() -> None:
    """Exit 3 is the snippet's own answer for the refusal, and nothing else may be graded as one."""
    code, output, _ = _run(NAMES, FL_DEPLOY_RUN_RC="3", FL_DEPLOY_RUN_SAYS="Invalid environment variables: LOG_FORMAT_")

    assert code == 2, output
    assert "LOG_FORMAT_" in output, output
    assert "NOTHING has been recreated" in output, output


def test_any_other_answer_is_an_advisory_the_deploy_survives() -> None:
    """A check that could not be made leaves the deploy where it stood before it existed; a refusal would stop a deploy over the checker."""
    code, output, _ = _run(NAMES, FL_DEPLOY_RUN_RC="125", FL_DEPLOY_RUN_SAYS="PermissionError")

    assert code == 0, output
    assert "(exit 125)" in output, output
    assert "PermissionError" in output, output


def test_what_the_container_said_goes_through_the_credential_filter() -> None:
    """This is a new site printing a container's own words, and a driver quotes the connection string back in exactly these failures."""
    code, output, _ = _run(NAMES, FL_DEPLOY_RUN_RC="3", FL_DEPLOY_RUN_SAYS="MONGODB_URI mongodb://user:pw@cluster.example.net/x")

    assert code == 2, output
    assert "user:pw@" not in output, output
    assert "<redacted>@cluster.example.net" in output, output


def test_the_file_is_mounted_read_only_where_the_image_puts_its_working_directory() -> None:
    """A `WORKDIR` change would leave the settings class with nothing at the path it reads, and the check would pass over every file forever."""
    workdir = re.search(r"^WORKDIR\s+(\S+)$", BACKEND_DOCKERFILE.read_text(encoding="utf-8"), re.MULTILINE)

    assert workdir is not None, "fl_backend/Dockerfile declares no WORKDIR"

    code, output, fixture = _run(f'printf "identity=%s:%s\\n" "$(id -u)" "$(id -g)" ; {NAMES}')
    argv = fixture.argv.read_text(encoding="utf-8").splitlines()
    identity = re.search(r"^identity=(\S+)$", output, re.MULTILINE)

    assert code == 0, output
    assert identity is not None, output
    mount = next((arg for arg in argv if arg.endswith(":ro")), "")
    assert mount.endswith(f":{workdir.group(1)}/.env:ro"), argv
    # The HOST half, which no other assertion reaches: a mount rebuilt from `${PWD}/.env`, or from
    # the frontend's file, still ends at the working directory the line above pins.
    assert "/fl_backend/.env:" in mount, argv
    # The identity of whoever ran the script, rather than a uid spelled here: a `sudo` deploy mounts
    # as root, so what is asserted is that the script asks, not which answer it gets.
    assert "--user" in argv, argv
    assert argv[argv.index("--user") + 1] == identity.group(1), (argv, identity.group(1))


def test_the_snippet_reaches_its_refusal_through_the_names_only_path() -> None:
    """`BackendConfig()` renders `input_value=` on its own error, so a snippet that constructed it directly would publish the rejected value."""
    snippet = _assignment("ENV_NAME_CHECK")

    assert "get_config()" in snippet, snippet
    assert "BackendConfig(" not in snippet, snippet
    # The other arm prints a class name and never the exception, whose message quotes what a source
    # could not read.
    assert "type(unexpected).__name__" in snippet, snippet


# --- the snippet itself, run rather than stubbed ------------------------------------------------------

# `venv_python` comes from `_lib.sh`, which the parent script already sources; `cd` reaches the
# fixture's own dotenv, the one file every case here is allowed to read.
SNIPPET: Final = """cd fl_backend
snippet_rc=0
"$(venv_python)" -c "$ENV_NAME_CHECK" || snippet_rc=$?
printf 'snippet=%s\\n' "$snippet_rc"
"""


def test_the_snippet_answers_3_naming_the_variables_and_never_a_rejected_value() -> None:
    """Every case above stubs `docker run`, so each proves what the script asks and none proves what the image answers."""
    code, output, _ = _run(SNIPPET, PYTHONPATH=(REPO_ROOT / "fl_backend").as_posix())

    assert code == 0, output
    assert "snippet=3" in output, output
    assert "A_NAME_NOTHING_DECLARES" in output, output
    assert "a value no case reads" not in output, output
    # The fixture's file declares nothing the backend requires either, so a missing required variable
    # reaches exit 3 beside the undeclared name -- both remedies the deploy's refusal words.
    assert "MONGODB_URI" in output, output


def test_a_settings_module_the_snippet_cannot_import_answers_the_advisory_arm() -> None:
    """The import sits inside a guard of its own.

    An except clause naming a class an ImportError never bound raises a NameError, and that
    traceback is what this arm exists to keep out.
    """
    code, output, _ = _run(SNIPPET, PYTHONPATH="")

    assert code == 0, output
    assert "snippet=4" in output, output
    assert "ModuleNotFoundError" in output, output
    assert "Traceback" not in output, output
