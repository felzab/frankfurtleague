"""SCRIPTS · what `scripts/ops/deploy.sh` copies and reads around a container's recreate.

`--force-recreate` discards a container's `json-file` stream and a failed deploy recreates the
application pair twice, so `:: copy_streams` runs on both paths -- refusing where nothing has been
recreated yet, and warning inside `:: roll_back`, where the site is already down and a log file is
not worth leaving it there. `:: check_env_names` and `:: check_env_names_held_once` read the
environment files before the recreate, the one place they are files, and print names alone.
`scripts/lib/_lib.sh :: wait_healthy`, sourced whole, is the read after it.
Each is driven behind a stand-in `docker`, so no daemon and no compose file of this machine; the
snippet that reader hands the image is run for real instead, because a stub records an argv and
answers nothing about what the image does.

Invariants:
  Nothing here reads or writes a real environment file: the fixture builds its own, of dummy names.
  Every case runs from the fixture's checkout: `_lib.sh` cd's to this repository on source.
"""

from __future__ import annotations

import os
import re
import shlex
from pathlib import Path
from typing import Final

import pytest
from conftest import BASH, base_env, lift_assignment, lift_function, new_root, run_shell, write_shell

SCRIPTS: Final = Path(__file__).resolve().parent.parent
REPO_ROOT: Final = SCRIPTS.parent
LIB: Final = SCRIPTS / "lib" / "_lib.sh"
DEPLOY: Final = SCRIPTS / "ops" / "deploy.sh"
LOCAL: Final = SCRIPTS / "ops" / "local.sh"
RUNBOOKS: Final = REPO_ROOT / "docs" / "ops" / "runbooks.md"


STAMP: Final = "2026-09-07T101500"

# `ps` and `logs` are steered by a service-name list in the environment. `run` and `ps` record their
# argv, the whole of what the mount, the user and the compose file are asserted from; `inspect`
# answers every container healthy.
STUB: Final = """#!/usr/bin/env bash
set -u
last=""
for arg in "$@"; do last="$arg"; done
if [[ "${1:-}" == "compose" ]]; then
  case " $* " in
    *" ps "*)
      printf '%s\\n' "$@" > "${FL_DEPLOY_PS_ARGV}"
      case ":${FL_DEPLOY_NO_CONTAINER:-}:" in *":${last}:"*) exit 0 ;; esac
      printf 'cid-%s\\n' "$last"; exit 0 ;;
    *" logs "*)
      case ":${FL_DEPLOY_LOGS_FAIL:-}:" in *":${last}:"*) exit "${FL_DEPLOY_LOGS_RC:-1}" ;; esac
      printf '%s line one\\n%s line two\\n' "$last" "$last"; exit 0 ;;
    *" config "*)
      printf '%s\\n' "$@" > "${FL_DEPLOY_ARGV}"
      # On BOTH streams: without --quiet this subcommand prints the resolved configuration, every
      # value in both environment files with it, so a case proving none of it reaches the operator
      # covers stdout too.
      if [[ -n "${FL_DEPLOY_CONFIG_SAYS:-}" ]]; then
        printf '%s\\n' "${FL_DEPLOY_CONFIG_SAYS}"
        printf '%s\\n' "${FL_DEPLOY_CONFIG_SAYS}" >&2
      fi
      exit "${FL_DEPLOY_CONFIG_RC:-0}" ;;
  esac
  exit 0
fi
if [[ "${1:-}" == "inspect" ]]; then printf 'healthy\\n'; exit 0; fi
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
    return lift_assignment(DEPLOY, name)


# Every assignment the environment readers build their containers from.
ENV_ASSIGNMENTS: Final = ("SHARED_ENV", "ENV_MOUNTS", "ENV_UNION_DIR", "ENV_UNION_BUILD", "ENV_NAME_CHECK", "ENV_OVERLAP_CHECK")


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
        self.ps_argv = self.root / "ps-argv.txt"


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
    environment["FL_DEPLOY_PS_ARGV"] = str(fixture.ps_argv)
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
        'IMAGE_BACKEND="backend-image"',
        *(_assignment(name) for name in ENV_ASSIGNMENTS),
        _lifted("service_cid"),
        _lifted("check_compose_config"),
        _lifted("copy_streams"),
        _lifted("read_env_names"),
        _lifted("check_env_names"),
        _lifted("check_env_names_held_once"),
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


def test_both_files_are_mounted_read_only_and_joined_in_a_tmpfs_the_reader_is_pointed_at() -> None:
    """The backend's own file alone would leave every name the checkout's holds reading as missing, and refuse every deploy."""
    code, output, fixture = _run(f'printf "identity=%s:%s\\n" "$(id -u)" "$(id -g)" ; {NAMES}')
    argv = fixture.argv.read_text(encoding="utf-8").splitlines()
    identity = re.search(r"^identity=(\S+)$", output, re.MULTILINE)

    assert code == 0, output
    assert identity is not None, output
    mounts = [arg for arg in argv if arg.endswith(":ro")]
    # The HOST halves, which nothing else reaches: the backend's file for the package half, and the
    # checkout's own, not a package's, for the shared half.
    assert len(mounts) == 2, argv
    assert mounts[0].endswith("/checkout/fl_backend/.env:/run/fl-env/package:ro"), argv
    assert mounts[1].endswith("/checkout/.env:/run/fl-env/shared:ro"), argv
    assert ["--tmpfs", "/tmp"] == argv[argv.index("--tmpfs") : argv.index("--tmpfs") + 2], argv
    # The join runs first and hands over to the snippet, which is told the directory it wrote into.
    # The snippet spans lines of the recorded argv, so only its neighbours are compared.
    joined = argv.index("-c")
    build = _assignment("ENV_UNION_BUILD").split("=", 1)[1][1:-1]
    assert argv[joined - 1 : joined + 5] == ["sh", "-c", build, "/run/fl-env", "/tmp", "python"], argv
    assert argv[-1] == "/tmp", argv
    # The identity of whoever ran the script, rather than a uid spelled here: a `sudo` deploy mounts
    # as root, so what is asserted is that the script asks, not which answer it gets.
    assert "--user" in argv, argv
    assert argv[argv.index("--user") + 1] == identity.group(1), (argv, identity.group(1))


# The join as the reader's container runs it, over two files of the fixture's own: the package's
# ending without a newline, which is the case the separator is for.
UNION: Final = """mkdir -p mounts union
printf 'PACKAGE_NAME=one' > mounts/package
printf 'SHARED_NAME=two\\n' > mounts/shared
sh -c "$ENV_UNION_BUILD" mounts union cat union/.env
"""


def test_the_join_puts_the_package_file_first_and_parts_it_from_the_checkouts_by_a_line() -> None:
    """Compose lets the last file listed win, and a package file ending without a newline would otherwise run into the checkout's first name."""
    code, output, _ = _run(UNION)

    assert code == 0, output
    assert output.splitlines()[-2:] == ["PACKAGE_NAME=one", "SHARED_NAME=two"], output


@pytest.mark.parametrize("half", ["package", "shared"])
def test_a_half_the_join_cannot_read_ends_it_as_a_read_failure_before_any_reader(half: str) -> None:
    """A join of one half would be judged as a file missing the other's names, a refusal pointing at the wrong remedy."""
    body = UNION.replace("sh -c", f"rm mounts/{half}\njoin_rc=0\nsh -c").replace("cat union/.env\n", "cat union/.env || join_rc=$?\n")
    code, output, _ = _run(body + 'printf "join=%s\\n" "$join_rc"\n')

    assert code == 0, output
    assert "join=4" in output, output
    assert "PACKAGE_NAME=one" not in output and "SHARED_NAME=two" not in output, output


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
SNIPPET: Final = """snippet_rc=0
"$(venv_python)" -c "$ENV_NAME_CHECK" fl_backend || snippet_rc=$?
printf 'snippet=%s\\n' "$snippet_rc"
"""


def test_the_snippet_answers_3_naming_the_variables_and_never_a_rejected_value() -> None:
    """Every case above stubs `docker run`, so each proves what the script asks and none proves what the image answers."""
    code, output, _ = _run(SNIPPET, PYTHONPATH=(REPO_ROOT / "fl_backend").as_posix())

    assert code == 0, output
    # The CI job running this scope installs the backend's dev group alone
    # (`.github/workflows/verify.yml`), so the import guard answers there: a real ending of the
    # deploy, pinned rather than passed over.
    if "ModuleNotFoundError" in output:
        assert "snippet=4" in output, output
        assert "Traceback" not in output, output
        return

    assert "snippet=3" in output, output
    assert "A_NAME_NOTHING_DECLARES" in output, output
    assert "a value no case reads" not in output, output
    # The fixture's file declares nothing the backend requires either, so a missing required variable
    # reaches exit 3 beside the undeclared name -- both remedies the deploy's refusal words.
    assert "MONGODB_URI" in output, output


# Two keys of the class and one carrying a `$`, which python-dotenv hands on as it stands and Compose
# would interpolate. Fabricated, of `k` alone.
KEY_OUTSIDE_THE_CLASS: Final = (
    "printf 'INTERNAL_API_KEY_BASE=%s$%s\\nINTERNAL_API_KEY_SYSTEM=%s\\nINTERNAL_API_KEY_ADMIN=%s\\n' "
    '"$(printf "k%.0s" {1..10})" "$(printf "k%.0s" {1..53})" "$(printf "k%.0s" {1..64})" "$(printf "k%.0s" {1..64})" '
    "> fl_backend/.env\n"
)


def test_the_snippet_refuses_a_key_outside_the_class_naming_that_key_alone() -> None:
    """The preflight judges a key with the pulled image's own validator, so the class reaches the deploy before any container sees it."""
    code, output, _ = _run(KEY_OUTSIDE_THE_CLASS + SNIPPET, PYTHONPATH=(REPO_ROOT / "fl_backend").as_posix())

    assert code == 0, output
    # The import guard's own answer where the job's venv lacks the application, as the case above pins.
    if "ModuleNotFoundError" in output:
        assert "snippet=4" in output, output
        return
    assert "snippet=3" in output, output
    assert "INTERNAL_API_KEY_BASE" in output, output
    assert "INTERNAL_API_KEY_SYSTEM" not in output, output
    assert "INTERNAL_API_KEY_ADMIN" not in output, output
    assert "kkkkkkkkkk$" not in output, output


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


# --- a name a package file and the checkout's both hold -------------------------------------------------

HELD_ONCE: Final = "check_env_names_held_once"


def test_a_name_both_files_hold_refuses_with_nothing_recreated() -> None:
    """Exit 3 is the snippet's own answer, and the names are all it prints."""
    said = "fl_backend/.env and .env both hold: INTERNAL_API_KEY_BASE"
    code, output, _ = _run(HELD_ONCE, FL_DEPLOY_RUN_RC="3", FL_DEPLOY_RUN_SAYS=said)

    assert code == 2, output
    assert said in output, output
    assert "keeping the one in .env" in output, output
    assert "NOTHING has been recreated" in output, output


def test_a_held_once_check_that_could_not_be_made_is_an_advisory() -> None:
    code, output, _ = _run(HELD_ONCE, FL_DEPLOY_RUN_RC="125", FL_DEPLOY_RUN_SAYS="Error")

    assert code == 0, output
    assert "(exit 125)" in output, output


def test_the_three_files_are_mounted_read_only_into_a_container_with_no_network() -> None:
    code, output, fixture = _run(HELD_ONCE)
    argv = fixture.argv.read_text(encoding="utf-8").splitlines()

    assert code == 0, output
    mounts = [arg for arg in argv if arg.endswith(":ro")]
    assert [mount.rsplit("/checkout/", 1)[1] for mount in mounts] == [
        ".env:/run/fl-env/.env:ro",
        "fl_frontend/.env:/run/fl-env/fl_frontend/.env:ro",
        "fl_backend/.env:/run/fl-env/fl_backend/.env:ro",
    ], argv
    assert ["--network", "none"] == argv[argv.index("--network") : argv.index("--network") + 2], argv
    assert argv[-3:] == ["/run/fl-env", "fl_frontend", "fl_backend"], argv


# The snippet over three files of the fixture's own, one name in two of them.
OVERLAP: Final = """mkdir -p fl_frontend
printf 'SHARED_KEY=a value no case prints\\n' > .env
printf 'SHARED_KEY=another value no case prints\\nFRONTEND_ONLY=x\\n' > fl_frontend/.env
snippet_rc=0
"$(venv_python)" -c "$ENV_OVERLAP_CHECK" . fl_frontend fl_backend || snippet_rc=$?
printf 'snippet=%s\\n' "$snippet_rc"
"""


def test_the_overlap_snippet_answers_3_naming_the_file_and_the_name_and_never_a_value() -> None:
    """Every stubbed case proves what the script asks; this proves what the image's python-dotenv answers."""
    code, output, _ = _run(OVERLAP)

    assert code == 0, output
    # python-dotenv reaches a dev-group-only venv through testcontainers alone, so the import guard
    # is pinned where it answers rather than passed over.
    if "ModuleNotFoundError" in output:
        assert "snippet=4" in output, output
        assert "Traceback" not in output, output
        return
    assert "snippet=3" in output, output
    assert "fl_frontend/.env and .env both hold: SHARED_KEY" in output, output
    assert "fl_backend/.env and" not in output, output
    assert "value no case prints" not in output, output


def test_the_held_once_check_runs_in_preflight_ahead_of_both_readers_and_before_the_recreate() -> None:
    """Every case above drives the lifted function; this is the call the deploy itself makes."""
    text = DEPLOY.read_text(encoding="utf-8")
    held_once = text.index("\ncheck_env_names_held_once\n")
    read = text.index("\ncheck_env_names\n")
    recreated = text.index('step "Recreating the application containers"')

    assert held_once < read < recreated, "scripts/ops/deploy.sh asks whether a name is held twice after a reader or not at all"


def test_the_overlap_snippet_refuses_a_package_name_differing_from_the_roots_in_case_alone() -> None:
    """pydantic-settings lowercases every name, so `shared_key` in a package file is the same variable to the backend."""
    code, output, _ = _run(OVERLAP.replace("SHARED_KEY=another", "shared_key=another"))

    assert code == 0, output
    if "ModuleNotFoundError" in output:
        assert "snippet=4" in output, output
        return
    assert "snippet=3" in output, output
    assert "fl_frontend/.env and .env both hold: shared_key" in output, output


def test_the_overlap_snippet_answers_0_where_no_name_repeats() -> None:
    code, output, _ = _run(OVERLAP.replace("SHARED_KEY=another", "OTHER_KEY=another"))

    assert code == 0, output
    # The guard's own answer, for the reason the case above pins it.
    if "ModuleNotFoundError" not in output:
        assert "snippet=0" in output, output


# --- the checkout root's `.env`, judged as text before compose or any reader ---------------------------

# The three keys, each a fabricated 64 `k`, written as the runbook's command writes them.
ROOT_KEYS: Final = "".join(f"INTERNAL_API_KEY_{tier}={'k' * 64}\n" for tier in ("BASE", "SYSTEM", "ADMIN"))


def _root_env(text: str) -> tuple[int, str]:
    """`scripts/lib/_lib.sh :: check_root_env` over a root file holding `text`, the fixture's own."""
    body = f"printf '%s' {shlex.quote(text)} > .env\ncheck_root_env .env\necho judged-clean\n"
    code, output, _ = _run(body)
    return code, output


def test_a_root_file_holding_the_three_keys_alone_is_clean() -> None:
    code, output = _root_env("# the keys\n\n" + ROOT_KEYS)

    assert code == 0, output
    assert "judged-clean" in output, output


@pytest.mark.parametrize(
    ("line", "said"),
    [
        ("COMPOSE_PROJECT_NAME=other", "COMPOSE_PROJECT_NAME is a compose setting"),
        ("MONGODB_URI=mongodb://no-login-here", "MONGODB_URI is not one of"),
        (f"INTERNAL_API_KEY_BASE={'k' * 64}", "INTERNAL_API_KEY_BASE is written a second time"),
        ("export OTHER=1", "is not NAME=value"),
    ],
    ids=["compose-setting", "one-service-name", "twice", "not-name-value"],
)
def test_a_root_file_holding_anything_else_refuses_before_compose_is_asked(line: str, said: str) -> None:
    """A compose setting is acted on by compose itself, and `MONGODB_URI` here would give both services one login."""
    code, output = _root_env(ROOT_KEYS + line + "\n")

    assert code == 2, output
    assert said in output, output
    assert "judged-clean" not in output, output


@pytest.mark.parametrize(
    "value",
    ["${OTHER}" + "k" * 56, "$OTHER" + "k" * 58, "'" + "k" * 62 + "'", '"' + "k" * 62 + '"', "`" + "k" * 62 + "`", "k" * 31 + '"' + "k" * 32],
    ids=["braced", "bare", "single-quoted", "double-quoted", "backticked", "double-quote-inside"],
)
def test_a_key_a_reader_would_rewrite_refuses_naming_the_key_and_never_the_value(value: str) -> None:
    """python-dotenv substitutes `${…}`, compose and `@next/env` any `$`, before either validator judges the key."""
    code, output = _root_env(ROOT_KEYS.replace(f"INTERNAL_API_KEY_BASE={'k' * 64}", f"INTERNAL_API_KEY_BASE={value}"))

    assert code == 2, output
    assert "INTERNAL_API_KEY_BASE's value carries a $ or a quote" in output, output
    assert "OTHER" not in output, output


def test_a_root_file_missing_a_key_refuses() -> None:
    code, output = _root_env(ROOT_KEYS.replace(f"INTERNAL_API_KEY_ADMIN={'k' * 64}\n", ""))

    assert code == 2, output
    assert "INTERNAL_API_KEY_ADMIN is missing" in output, output


@pytest.mark.parametrize(("script", "first_compose"), [(DEPLOY, "\nif (( STATUS_ONLY )); then"), (LOCAL, "\nif (( DOWN )); then")])
def test_the_root_file_is_judged_before_the_first_compose_call(script: Path, first_compose: str) -> None:
    """`--status` and `--down` call compose too, which would take a `COMPOSE_*` line as its own."""
    text = script.read_text(encoding="utf-8")

    assert text.index("\ncheck_root_env ") < text.index(first_compose), script.name


# --- the configuration compose reads, before anything is pulled ---------------------------------------

CONFIG: Final = "check_compose_config"


def test_a_configuration_compose_cannot_read_refuses_with_nothing_pulled_or_recreated() -> None:
    """Compose stops before it touches a container, so a refusal is the only ending true of the site."""
    code, output, _ = _run(
        CONFIG,
        FL_DEPLOY_CONFIG_RC="15",
        FL_DEPLOY_CONFIG_SAYS="env_file: unterminated quoted string A_VALUE_NO_CASE_READS",
    )

    assert code == 2, output
    assert "(exit 15)" in output, output
    assert "NOTHING has been pulled or recreated, and the site is untouched" in output, output
    # The four files, because the refusal cannot say which of them the message named.
    assert "docker-compose.yml" in output, output
    assert "fl_backend/.env" in output, output
    assert "fl_frontend/.env" in output, output
    assert "fl_backend/.env and .env." in output, output
    # `redact_uri_credentials` is for a container's log and reaches none of this, and a parse error
    # quotes the line it could not read -- which in an environment file is a value.
    assert "A_VALUE_NO_CASE_READS" not in output, output
    assert "unterminated" not in output, output


def test_a_configuration_compose_reads_passes_the_preflight() -> None:
    code, output, _ = _run(CONFIG)

    assert code == 0, output
    assert "compose parses docker-compose.yml" in output, output


def test_the_validation_asks_compose_to_parse_and_to_print_nothing() -> None:
    """`--quiet` is the whole of what keeps the resolved configuration, every value in it, off the terminal."""
    code, output, fixture = _run(CONFIG)
    argv = fixture.argv.read_text(encoding="utf-8").splitlines()

    assert code == 0, output
    assert argv[0] == "compose", argv
    assert "config" in argv, argv
    assert "--quiet" in argv, argv
    assert argv[argv.index("-f") + 1] == "docker-compose.yml", argv


def test_the_configuration_is_read_before_anything_is_pulled_or_recreated() -> None:
    text = DEPLOY.read_text(encoding="utf-8")
    validated = text.index("\ncheck_compose_config\n")
    pulled = text.index('section "pull"')
    recreated = text.index('step "Recreating the application containers"')

    assert validated < pulled < recreated, "scripts/ops/deploy.sh validates the configuration after it has already pulled or recreated"


# --- the health read after the recreate ----------------------------------------------------------------


def test_the_health_read_hands_compose_the_deploys_file_as_two_arguments() -> None:
    """Under `_lib.sh`'s IFS, a flag and its file joined in one expansion arrive as one argument.

    Compose reads a file named " docker-compose.yml", exits 1, and the deploy refuses at the health wait.
    """
    code, output, fixture = _run('wait_healthy "$COMPOSE" backend 3')
    argv = fixture.ps_argv.read_text(encoding="utf-8").splitlines()

    assert code == 0, output
    assert "'backend' is healthy" in output, output
    assert argv[:5] == ["compose", "-f", "docker-compose.yml", "ps", "-q"], argv


def test_the_local_stacks_health_read_names_no_file_and_leaves_the_choice_to_compose_file() -> None:
    code, output, fixture = _run('wait_healthy "" backend 3')
    argv = fixture.ps_argv.read_text(encoding="utf-8").splitlines()

    assert code == 0, output
    assert argv[:3] == ["compose", "ps", "-q"], argv
