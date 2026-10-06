"""SCRIPTS · what `scripts/ops/deploy.sh` copies and reads around a container's recreate.

`--force-recreate` discards a container's `json-file` stream and a failed deploy recreates the
application pair twice, so `:: copy_streams` runs on both paths -- refusing where nothing has been
recreated yet, and warning inside `:: roll_back`, where the site is already down and a log file is
not worth leaving it there. `:: check_env_names` reads the backend's environment file before the
recreate, the one place it is a file, and prints names alone.
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
import shutil
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
# `run` answers as `docker run` does, and records what its container was handed: its stdin, and
# whether Git Bash was told to leave its arguments alone. Read off the subcommand's position, since
# a snippet in the argv may spell any word.
if [[ "${1:-}" == "compose" && " ${*:2:3} " == *" run "* ]]; then
  printf '%s\\n' "$@" > "${FL_DEPLOY_ARGV}"
  cat > "${FL_DEPLOY_ARGV}.stdin"
  printf '%s' "${MSYS_NO_PATHCONV-unset}" > "${FL_DEPLOY_ARGV}.pathconv"
  if [[ -n "${FL_DEPLOY_RUN_SAYS:-}" ]]; then printf '%s\\n' "${FL_DEPLOY_RUN_SAYS}" >&2; fi
  exit "${FL_DEPLOY_RUN_RC:-0}"
fi
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
ENV_ASSIGNMENTS: Final = ("ENV_MOUNTS", "ENV_NAME_CHECK")


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
    # The key check reads it over the mount path, so a caller's own would decide every key case.
    environment.pop("ACTOR_SIGNING_KEY_FILE", None)
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


def test_the_backend_file_alone_is_mounted_read_only_where_the_reader_is_pointed() -> None:
    """The container is handed the package's file and nothing else, which is the whole of what compose hands the service."""
    code, output, fixture = _run(f'printf "identity=%s:%s\\n" "$(id -u)" "$(id -g)" ; {NAMES}')
    argv = fixture.argv.read_text(encoding="utf-8").splitlines()
    identity = re.search(r"^identity=(\S+)$", output, re.MULTILINE)

    assert code == 0, output
    assert identity is not None, output
    mounts = [arg for arg in argv if arg.endswith(":ro")]
    assert len(mounts) == 1 and mounts[0].endswith("/checkout/fl_backend/.env:/run/fl-env/.env:ro"), argv
    assert "--tmpfs" not in argv, argv
    # The image runs the reader itself, told the directory the file is mounted in. The snippet spans
    # lines of the recorded argv, so only its neighbours are compared.
    assert argv[argv.index("backend-image") + 1 : argv.index("backend-image") + 3] == ["python", "-c"], argv
    assert argv[-1] == "/run/fl-env", argv
    # The identity of whoever ran the script, rather than a uid spelled here: a `sudo` deploy mounts
    # as root, so what is asserted is that the script asks, not which answer it gets.
    assert "--user" in argv, argv
    assert argv[argv.index("--user") + 1] == identity.group(1), (argv, identity.group(1))


def test_the_snippet_reaches_its_refusal_through_the_names_only_path() -> None:
    """`BackendEnvironment()` renders `input_value=` on its own error, so a snippet constructing it would publish the rejected value."""
    snippet = _assignment("ENV_NAME_CHECK")

    assert "read_environment()" in snippet, snippet
    assert "BackendEnvironment(" not in snippet, snippet
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
    # The application is installed wherever this scope runs, CI's job included, so an import failure
    # here is the case failing, never the advisory arm the case below pins.
    assert "snippet=3" in output, output
    assert "A_NAME_NOTHING_DECLARES" in output, output
    assert "a value no case reads" not in output, output
    # The fixture's file declares nothing the backend requires either, so a missing required variable
    # reaches exit 3 beside the undeclared name -- both remedies the deploy's refusal words.
    assert "DB_BASE_NAME" in output, output


# A backend environment the settings accept, its public key a pair's of the case's own, and the five
# secret files, two keys of the class and one carrying a space. Fabricated, of `k` alone.
KEY_OUTSIDE_THE_CLASS: Final = """node -e "$PAIR_JS" ed25519 fl_backend/key.pem fl_backend/public.env
printf 'API_TRUSTED_HOSTS=localhost\\nAPI_CORS_ALLOWED_ORIGINS=http://localhost:3000\\n' > fl_backend/.env
{ printf 'DB_BASE_NAME=league\\n'; cat fl_backend/public.env; } >> fl_backend/.env
mkdir -p fl_backend/run-secrets
printf 'mongodb://localhost:27017/?directConnection=true' > fl_backend/run-secrets/backend_mongodb_uri
printf 'k%.0s' {1..64} > fl_backend/run-secrets/sperrliste_schluessel
printf '%s %s' "$(printf 'k%.0s' {1..10})" "$(printf 'k%.0s' {1..53})" > fl_backend/run-secrets/internal_api_key_base
printf 'k%.0s' {1..64} > fl_backend/run-secrets/internal_api_key_system
printf 'k%.0s' {1..64} > fl_backend/run-secrets/internal_api_key_admin
export SECRETS_DIR=run-secrets
"""


def test_the_snippet_refuses_a_line_a_secret_file_replaced_naming_it_alone() -> None:
    """The file is otherwise one the settings accept, so the line alone is what refuses, and its name alone what is printed."""
    left_behind = KEY_OUTSIDE_THE_CLASS.split("mkdir -p", 1)[0] + "printf 'MONGODB_URI=a value no case reads\\n' >> fl_backend/.env\n"
    code, output, _ = _run(left_behind + SNIPPET, PYTHONPATH=(REPO_ROOT / "fl_backend").as_posix(), PAIR_JS=PAIR)

    assert code == 0, output
    assert "snippet=3" in output, output
    assert re.search(r"^Invalid environment variables: MONGODB_URI\r?$", output, re.MULTILINE), output
    assert "a value no case reads" not in output, output


def test_the_boot_build_refuses_a_key_file_outside_the_class_naming_that_file_alone() -> None:
    """The preflight judges a key with the pulled image's own validator, in its container, so the class reaches the deploy first."""
    code, output, _ = _run(KEY_OUTSIDE_THE_CLASS + BOOT_SNIPPET, PYTHONPATH=(REPO_ROOT / "fl_backend").as_posix(), PAIR_JS=PAIR)

    assert code == 0, output
    assert "boot=3" in output, output
    assert "internal_api_key_base" in output, output
    assert "internal_api_key_system" not in output, output
    assert "internal_api_key_admin" not in output, output
    assert "kkkkkkkkkk k" not in output, output


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


# --- each package's `.env`, judged as text for the spellings its readers disagree on -----------------


def _env_spellings(text: str) -> tuple[int, str]:
    """`scripts/lib/_lib.sh :: check_env_spellings` over a file holding `text`, the fixture's own."""
    body = f"printf '%s' {shlex.quote(text)} > fl_backend/.env\ncheck_env_spellings fl_backend/.env\necho judged-clean\n"
    code, output, _ = _run(body)
    return code, output


def test_a_file_every_reader_takes_alike_is_clean() -> None:
    """Comments say anything; an encoded URI, a spaced comment, a matched quote pair and a bare backslash read alike."""
    lines = ("# costs $5 #1", "MONGODB_URI=mongodb://user:pa%24ss%23@db/x", "", "LOG_FORMAT='json' # the stream")
    lines += ('FROM="a#b"', "PATHLIKE=a\\b", "TICK=a`b")
    code, output = _env_spellings("\n".join(lines) + "\n")

    assert code == 0, output
    assert "judged-clean" in output, output


@pytest.mark.parametrize(
    ("line", "said"),
    [
        pytest.param("MONGODB_URI=mongodb://user:pa$ss@db/x", "holds a $", id="dollar-bare"),
        pytest.param("SECRET=${OTHER}", "holds a $", id="dollar-braced"),
        pytest.param("QUOTED='a$b'", "holds a $", id="dollar-single-quoted"),
        pytest.param('DOUBLE="a$b"', "holds a $", id="dollar-double-quoted"),
        pytest.param("export SPACED = a$b", "holds a $", id="dollar-export-and-spaces"),
        pytest.param("TRAILING=plain # was $5", "holds a $", id="dollar-in-a-trailing-comment"),
        pytest.param("HASH=a#b", "holds a # with no space before it", id="hash-unspaced"),
        pytest.param("HASH=#abc", "holds a # with no space before it", id="hash-leading"),
        pytest.param("SLASH='a\\b'", "holds a backslash inside quotes", id="backslash-single-quoted"),
        pytest.param('SLASH="a\\b"', "holds a backslash inside quotes", id="backslash-double-quoted"),
        pytest.param("TICK=`abc`", "opens with a backtick", id="backtick-leading"),
    ],
)
def test_a_spelling_the_readers_disagree_on_refuses_naming_the_line_never_the_value(line: str, said: str) -> None:
    """Each was read apart by python-dotenv, `@next/env` and `node:util :: parseEnv`; `$` even inside single quotes."""
    code, output = _env_spellings(f"FIRST=1\n{line}\n")
    name = line.removeprefix("export ").split("=", 1)[0].strip()

    assert code == 2, output
    assert f"line 2: {name} {said}" in output, output
    assert line.split("=", 1)[1].strip() not in output, output
    assert "judged-clean" not in output, output


@pytest.mark.parametrize("line", ["LOG_FORMAT: json", "  LOG_FORMAT :json", "export LOG_FORMAT: json"], ids=["bare", "spaced", "export"])
def test_a_line_written_with_a_colon_refuses_naming_the_line_never_the_value(line: str) -> None:
    """Compose's parser takes each; python-dotenv and `parseEnv` skip each, driven; `@next/env` 16.3.8, driven, takes the bare one alone."""
    code, output = _env_spellings(f"FIRST=1\n{line}\n")

    assert code == 2, output
    assert "line 2: LOG_FORMAT is written with a colon" in output, output
    assert "json" not in output.replace("LOG_FORMAT", ""), output
    assert "judged-clean" not in output, output


# --- the actor token's key pair ---------------------------------------------------------------------------

# A pair of the case's own, generated with the node the check itself runs on and never committed:
# `$1` the key type, `$2` where the private half goes, `$3` a file naming the public half as
# `fl_backend/.env` does.
PAIR: Final = """
const { generateKeyPairSync } = require("node:crypto");
const { writeFileSync } = require("node:fs");
const [type, pem, env] = process.argv.slice(1);
const { privateKey, publicKey } = generateKeyPairSync(type);
writeFileSync(pem, privateKey.export({ type: "pkcs8", format: "pem" }));
writeFileSync(env, `ACTOR_TOKEN_PUBLIC_KEY=${publicKey.export({ format: "jwk" }).x}\\n`);
"""

# The check as the frontend image runs it, its key at `$1` and the environment file on stdin.
CHECK: Final = """check_rc=0
node -e "$ACTOR_KEY_CHECK" "$1" < "$2" || check_rc=$?
printf 'check=%s\\n' "$check_rc"
"""


def _judged(setup: str, key: str, env: str) -> str:
    """The check's printed answer over files `setup` wrote, with the exit code on its last line."""
    code, output, _ = _run(f"{setup}\nset -- {key} {env}\n{CHECK}", PAIR_JS=PAIR)

    assert code == 0, output
    # Neither half of any pair is ever printed: the PEM's armour, the public half's name with its value.
    assert "PRIVATE KEY" not in output, output
    assert re.search(r"[A-Za-z0-9_-]{43}", output) is None, output
    return output


PLACING_STEPS: Final[dict[str, str]] = {
    "server": r"`(sudo install -o 1001 -g 1001 -m 400 \"\$t/key\" secrets/fl_actor_signing_key && rm -rf \"\$t\")`",
    "development": r"`(\(umask 077 && mkdir -p secrets && mv \"\$t/key\" secrets/fl_actor_signing_key\) && rm -rf \"\$t\")`",
}


def _placing_step(text: str, machine: str) -> str:
    """One machine's placing step as the runbook prints it, found exactly once."""
    placed = re.findall(PLACING_STEPS[machine], text)
    assert len(placed) == 1, (machine, placed)
    return placed[0]


# What makes each step fail where it stands: a `sudo` refusing on PATH for the server's, which this host
# could not run as written anyway, and a file where the development step's directory goes.
FAILING_UNDER: Final[dict[str, str]] = {
    "server": (
        "mkdir refusing && printf '#!/usr/bin/env bash\\nexit 1\\n' > refusing/sudo && chmod +x refusing/sudo"
        ' && export PATH="$PWD/refusing:$PATH"'
    ),
    "development": ": > secrets",
}


@pytest.mark.parametrize("machine", sorted(PLACING_STEPS))
def test_a_placing_step_that_fails_keeps_the_only_key(machine: str) -> None:
    """The temporary directory holds the one copy of the private half, so a failed placing must leave it there."""
    text = RUNBOOKS.read_text(encoding="utf-8")
    generate = next(line for line in text.splitlines() if line.startswith('t="$(mktemp -d)" && (umask 077 && openssl genpkey'))
    # In a shell of its own, as a person pastes it: the harness's `errexit` would stop at the failure.
    step = f"t=\"$t\" bash -c '{_placing_step(text, machine)}' || true"
    kept = 'printf "kept=%s\\n" "$(test -f "$t/key" && echo 1 || echo 0)"; rm -rf "$t"'
    code, output, _ = _run(f"{generate}\n{FAILING_UNDER[machine]}\n{step}\n{kept}")

    assert code == 0, output
    assert "kept=1" in output, output


def test_the_runbooks_command_writes_a_pair_the_check_passes() -> None:
    """Run as the runbook prints it, over the fixture's own `fl_backend/.env`: Git Bash's `openssl` is the carriage-return case."""
    text = RUNBOOKS.read_text(encoding="utf-8")
    generate = next(line for line in text.splitlines() if line.startswith('t="$(mktemp -d)" && (umask 077 && openssl genpkey'))
    # The development machine's placing step, the server's being `sudo install` to a uid this host may not have.
    placed = _placing_step(text, "development")
    # The server's `secrets/` is root's, so the generating line writes nothing there: counted between the two steps.
    inside = 'printf "inside=%s\\n" "$(ls -A secrets 2>/dev/null | wc -l | tr -d \' \')"'
    command = f"{generate}\n{inside}\n{placed}"
    # Counted, never printed: each file's carriage returns, which the runbook promises it writes none of.
    counted = "printf \"cr=%s\\n\" \"$(cat secrets/fl_actor_signing_key fl_backend/.env | tr -cd '\\r' | wc -c | tr -d ' ')\""
    output = _judged(f"{command}\n{counted}", "secrets/fl_actor_signing_key", "fl_backend/.env")

    assert "check=0" in output, output
    assert "cr=0" in output, output
    assert "inside=0" in output, output


def test_a_matching_pair_passes() -> None:
    output = _judged('node -e "$PAIR_JS" ed25519 key.pem env.txt', "key.pem", "env.txt")

    assert "check=0" in output, output


def test_the_key_is_read_where_the_environment_names_it_rather_than_at_the_mount() -> None:
    """The frontend's config reads `ACTOR_SIGNING_KEY_FILE` over its default, so the check does too."""
    output = _judged('node -e "$PAIR_JS" ed25519 named.pem env.txt\nexport ACTOR_SIGNING_KEY_FILE=named.pem', "absent.pem", "env.txt")

    assert "check=0" in output, output


@pytest.mark.parametrize(
    ("setup", "key", "said"),
    [
        pytest.param(
            'node -e "$PAIR_JS" ed25519 key.pem mine.txt\nnode -e "$PAIR_JS" ed25519 other.pem env.txt',
            "key.pem",
            "ACTOR_TOKEN_PUBLIC_KEY is not the public half of the signing key",
            id="another-pairs-public-half",
        ),
        pytest.param(
            "node -e \"$PAIR_JS\" ed25519 key.pem mine.txt\nprintf 'ACTOR_TOKEN_PUBLIC_KEY=short\\n' > env.txt",
            "key.pem",
            "ACTOR_TOKEN_PUBLIC_KEY is not the base64url of 32 bytes",
            id="malformed-public-half",
        ),
        pytest.param(
            "node -e \"$PAIR_JS\" ed25519 key.pem mine.txt\nprintf 'OTHER=1\\n' > env.txt",
            "key.pem",
            "ACTOR_TOKEN_PUBLIC_KEY is missing from fl_backend/.env",
            id="no-public-half",
        ),
    ],
)
def test_a_pair_that_would_not_work_answers_3_naming_what_is_wrong(setup: str, key: str, said: str) -> None:
    """3 is every reader's refusal; each line says which half to fix and prints neither."""
    output = _judged(setup, key, "env.txt")

    assert "check=3" in output, output
    assert said in output, output


@pytest.mark.parametrize(
    ("setup", "key"),
    [
        pytest.param('node -e "$PAIR_JS" ed25519 other.pem env.txt', "absent.pem", id="absent"),
        pytest.param("node -e \"$PAIR_JS\" ed25519 other.pem env.txt\nprintf 'not a key\\n' > key.pem", "key.pem", id="no-key-in-the-file"),
        pytest.param('node -e "$PAIR_JS" ed25519 key.pem env.txt\nexport ACTOR_SIGNING_KEY_FILE=', "key.pem", id="an-empty-path"),
    ],
)
def test_a_key_the_check_cannot_read_is_no_verdict_on_the_pair(setup: str, key: str) -> None:
    """The frontend's boot refuses such a key before this check runs (`fl_frontend/src/instrumentation.test.ts`), so here it is the advisory."""
    output = _judged(setup, key, "env.txt")

    assert "check=4" in output, output


KEY_CHECK: Final = 'check_actor_key "NOTHING has been recreated." docker compose -f docker-compose.yml run --rm --no-deps -T frontend'


def test_a_refused_pair_stops_the_run_with_its_remedy() -> None:
    code, output, _ = _run(KEY_CHECK, FL_DEPLOY_RUN_RC="3", FL_DEPLOY_RUN_SAYS="ACTOR_TOKEN_PUBLIC_KEY is missing from fl_backend/.env")

    assert code == 2, output
    assert "ACTOR_TOKEN_PUBLIC_KEY is missing from fl_backend/.env" in output, output
    assert "docs/ops/runbooks.md §16" in output, output
    assert "NOTHING has been recreated." in output, output


def test_a_pair_check_that_could_not_be_made_is_an_advisory() -> None:
    code, output, _ = _run(KEY_CHECK, FL_DEPLOY_RUN_RC="125", FL_DEPLOY_RUN_SAYS="Error")

    assert code == 0, output
    assert "(exit 125)" in output, output


def _key_check_call(script: Path) -> str:
    return "check_actor_key " + script.read_text(encoding="utf-8").split("\ncheck_actor_key ", 1)[1].split("\n\n", 1)[0]


@pytest.mark.parametrize("script", [DEPLOY, LOCAL], ids=["deploy", "local"])
def test_each_script_runs_the_check_in_the_frontend_service_as_the_stack_starts_it(script: Path) -> None:
    """A bare image run holds none of the service's environment, and passes a key the frontend never finds.

    No `--user`: the key is its image user's, whom the caller's uid is not.
    """
    code, output, fixture = _run(_key_check_call(script))
    argv = fixture.argv.read_text(encoding="utf-8").splitlines()

    assert code == 0, output
    assert argv[0] == "compose", argv
    run = argv.index("run")
    assert argv[run : run + 5] == ["run", "--rm", "--no-deps", "-T", "frontend"], argv
    assert "--user" not in argv, argv
    assert argv[argv.index("-e") - 1 : argv.index("-e") + 1] == ["node", "-e"], argv
    assert argv[-1] == "/run/secrets/fl_actor_signing_key", argv


def test_git_bash_is_told_to_leave_the_mount_path_as_written() -> None:
    """Git Bash rewrites a `/run/...` argument to a native program into a Windows path.

    The container then reads the key as missing on every development machine; Linux ignores the variable.
    """
    code, output, fixture = _run(KEY_CHECK)

    assert code == 0, output
    assert Path(f"{fixture.argv}.pathconv").read_text(encoding="utf-8") == "1"


def test_the_container_is_handed_the_public_half_s_line_and_nothing_else() -> None:
    """The rest of `fl_backend/.env` is the backend's database login and keys, which the frontend never holds."""
    lines = "MONGODB_URI=mongodb://user:secret@db/x\\nACTOR_TOKEN_PUBLIC_KEY=the-public-half\\nSPERRLISTE_SCHLUESSEL=other\\n"
    code, output, fixture = _run(f"printf '{lines}' > fl_backend/.env\n{KEY_CHECK}")

    assert code == 0, output
    assert Path(f"{fixture.argv}.stdin").read_text(encoding="utf-8") == "ACTOR_TOKEN_PUBLIC_KEY=the-public-half\n"


def test_a_backend_file_without_the_public_half_hands_the_check_an_empty_line() -> None:
    """grep's "no such line" is the check's own finding to make, never a refusal of the read."""
    code, output, fixture = _run(KEY_CHECK)

    assert code == 0, output
    assert Path(f"{fixture.argv}.stdin").read_text(encoding="utf-8") == "\n"


# `stat` answered by a function of the case's own, since a Windows filesystem keeps no mode to set.
MODE: Final = "stat() { STAT_ANSWER; }\n" + _lifted("signing_key_mode_advisory") + "\nsigning_key_mode_advisory\necho judged"


@pytest.mark.parametrize(
    ("answer", "warned"),
    [
        pytest.param("printf '400\\n'", "", id="the-frontend-user-s-alone"),
        pytest.param("printf '440\\n'", "has mode 440", id="its-group-reads-it"),
        pytest.param("printf '604\\n'", "has mode 604", id="everyone-reads-it"),
        pytest.param("printf '420\\n'", "has mode 420", id="its-group-writes-it"),
        pytest.param("return 1", "could not be read", id="stat-fails"),
    ],
)
def test_a_key_another_account_can_reach_draws_a_warning_and_never_a_refusal(answer: str, warned: str) -> None:
    code, output, _ = _run(MODE.replace("STAT_ANSWER", answer))

    assert code == 0, output
    assert "judged" in output, output
    if warned:
        assert warned in output, output
    else:
        assert "!!" not in output, output


def test_the_deploy_reads_the_key_s_mode_once_it_knows_the_key_is_there() -> None:
    text = DEPLOY.read_text(encoding="utf-8")

    assert text.index('\nrequire_file "$SIGNING_KEY_FILE"') < text.index("\nsigning_key_mode_advisory\n"), DEPLOY.name


@pytest.mark.parametrize(
    ("script", "before"),
    [(DEPLOY, 'step "Recreating the application containers"'), (LOCAL, 'section "start"')],
)
def test_the_pair_is_judged_after_the_frontend_s_boot_and_before_anything_starts(script: Path, before: str) -> None:
    """The boot has refused a key it cannot read where its environment points it, which the pair check takes as read."""
    text = script.read_text(encoding="utf-8")

    assert text.index("\ncheck_frontend_boot_config ") < text.index("\ncheck_actor_key ") < text.index(before), script.name
    assert text.index('\nrequire_file "$SIGNING_KEY_FILE"') < text.index("\ncheck_actor_key "), script.name


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
    # The three files, because the refusal cannot say which of them the message named.
    assert "docker-compose.yml" in output, output
    assert "fl_backend/.env" in output, output
    assert "fl_frontend/.env" in output, output
    assert "fl_frontend/.env and fl_backend/.env." in output, output
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


# --- each service's settings and secret files, built by its own container ---------------------------------

RUNNER: Final = 'docker compose -f "$COMPOSE" run --rm --no-deps -T'
FRONTEND_BOOT: Final = f'check_frontend_boot_config "NOTHING has been recreated." production {RUNNER}'
BOOT_CHECK: Final = f'check_backend_boot_config "NOTHING has been recreated." {RUNNER}'


def _lib_array(name: str) -> list[str]:
    return lift_assignment(LIB, name).split("=", 1)[1].strip("()").split()


def test_settings_the_frontend_refuses_stop_the_run_with_nothing_recreated() -> None:
    """Exit 3 is the boot's own refusal; its CRITICAL line is what names the setting, so it is printed."""
    said = '{"level":"CRITICAL","error_code":"FE-BOOT-004","files":"auth_secret"}'
    code, output, _ = _run(FRONTEND_BOOT, FL_DEPLOY_RUN_RC="3", FL_DEPLOY_RUN_SAYS=said)

    assert code == 2, output
    assert said in output, output
    assert "docs/ops/runbooks.md §16" in output, output
    assert "NOTHING has been recreated." in output, output


def test_a_frontend_boot_that_could_not_be_asked_is_an_advisory() -> None:
    """A fault ends the boot on 1, which is no verdict on the host's files."""
    code, output, _ = _run(FRONTEND_BOOT, FL_DEPLOY_RUN_RC="1", FL_DEPLOY_RUN_SAYS="Error: Cannot find module")

    assert code == 0, output
    assert "(exit 1)" in output, output
    assert "Error: Cannot find module" in output, output


def test_a_passing_boot_prints_nothing_its_server_said() -> None:
    """Next's start banner is all a pass writes, and it names a listening address nobody can reach."""
    code, output, _ = _run(FRONTEND_BOOT, FL_DEPLOY_RUN_SAYS="Next.js banner")

    assert code == 0, output
    assert "Next.js banner" not in output, output


@pytest.mark.parametrize("deployment", ["production", "local"])
def test_the_boot_runs_the_image_s_own_command_as_the_service_told_which_deployment_it_is(deployment: str) -> None:
    """No command after the service, so the image's server runs the gates; no `--user`, the files being its user's."""
    code, output, fixture = _run(FRONTEND_BOOT.replace(" production ", f" {deployment} "))
    argv = fixture.argv.read_text(encoding="utf-8").splitlines()

    assert code == 0, output
    run = argv.index("run")
    assert argv[run:] == ["run", "--rm", "--no-deps", "-T", "-e", f"BOOT_CHECK={deployment}", "frontend"], argv
    assert "--user" not in argv, argv


def test_settings_the_backend_refuses_stop_the_run_with_nothing_recreated() -> None:
    code, output, fixture = _run(BOOT_CHECK, FL_DEPLOY_RUN_RC="3", FL_DEPLOY_RUN_SAYS="Invalid environment variables: SPERRLISTE_SCHLUESSEL")
    argv = fixture.argv.read_text(encoding="utf-8").splitlines()

    assert code == 2, output
    assert "SPERRLISTE_SCHLUESSEL" in output, output
    assert "NOTHING has been recreated." in output, output
    run = argv.index("run")
    assert argv[run : run + 7] == ["run", "--rm", "--no-deps", "-T", "backend", "python", "-c"], argv


def test_a_settings_check_that_could_not_be_made_is_an_advisory() -> None:
    code, output, _ = _run(BOOT_CHECK, FL_DEPLOY_RUN_RC="4", FL_DEPLOY_RUN_SAYS="ModuleNotFoundError")

    assert code == 0, output
    assert "(exit 4)" in output, output


BOOT_SNIPPET: Final = """boot_rc=0
( cd fl_backend && "$(venv_python)" -c "$BACKEND_BOOT_CHECK" ) || boot_rc=$?
printf 'boot=%s\\n' "$boot_rc"
"""


def test_the_settings_program_answers_3_naming_what_it_refuses_and_never_a_value() -> None:
    """Run for real, over the fixture's file of an undeclared name and nothing the backend requires."""
    code, output, _ = _run(BOOT_SNIPPET, PYTHONPATH=(REPO_ROOT / "fl_backend").as_posix())

    assert code == 0, output
    assert "boot=3" in output, output
    assert "a value no case reads" not in output, output


@pytest.mark.parametrize(
    ("script", "after", "before"),
    [
        (DEPLOY, "\ncheck_frontend_env_names\n", 'step "Recreating the application containers"'),
        (LOCAL, 'ok "images built"', 'section "start"'),
    ],
)
def test_each_boot_is_judged_after_the_build_it_runs_in_and_before_anything_starts(script: Path, after: str, before: str) -> None:
    text = script.read_text(encoding="utf-8")

    for call in ("\ncheck_frontend_boot_config ", "\ncheck_backend_boot_config "):
        assert text.index(after) < text.index(call) < text.index(before), (script.name, call)


@pytest.mark.parametrize(("script", "deployment"), [(DEPLOY, "production"), (LOCAL, "local")])
def test_each_script_names_the_deployment_its_frontend_is_judged_as(script: Path, deployment: str) -> None:
    """The boot holds `APP_ENV` to it, so a production host whose file says `local` is not judged as the local stack."""
    text = script.read_text(encoding="utf-8")

    assert re.search(rf'\ncheck_frontend_boot_config "[^"]*" {deployment} ', text), script.name


# --- what the rollback tells the operator ---------------------------------------------------------------

ADVICE: Final = "\n".join((_lifted("rollback_advice"), "rollback_advice"))


@pytest.mark.parametrize(("pin", "named"), [("sha-0123abc", "./scripts/ops/deploy.sh sha-0123abc"), ("", "./scripts/ops/deploy.sh <tag>")])
def test_the_rollback_names_the_tag_it_restored_or_asks_for_one(pin: str, named: str) -> None:
    """The registry's `:latest` still names the failed build, so a bare re-run would fetch it again."""
    code, output, _ = _run(f'PREV_PIN="{pin}"\n{ADVICE}')

    assert code == 0, output
    assert named in output, output
    assert "DO NOT re-run this" in output, output


# --- a credential's line in an environment file -------------------------------------------------------------

CREDENTIAL_LINES: Final = """printf 'LOG_FORMAT=json\\nmongodb_uri=a value no case reads\\n' > fl_backend/.env
mkdir -p fl_frontend
printf 'INTERNAL_API_KEY_BASE=a value no case reads\\nAUTH_SECRET\\n' > fl_frontend/.env
refuse_credential_lines fl_backend/.env fl_frontend/.env
echo credential-lines-passed
"""


def test_every_credential_line_refuses_naming_each_in_any_case_and_no_value() -> None:
    """Both files, a lower-cased name and compose's bare pass-through form among them, and nothing after the check runs."""
    code, output, _ = _run(CREDENTIAL_LINES)

    assert code == 2, output
    assert "credential-lines-passed" not in output, output
    assert "fl_backend/.env: mongodb_uri" in output, output
    assert "fl_frontend/.env: INTERNAL_API_KEY_BASE AUTH_SECRET" in output, output
    assert "LOG_FORMAT" not in output, output
    assert "a value no case reads" not in output, output
    assert "Delete them" in output, output


# Each a form compose's own parser reads a name from (compose-go `dotenv/parser.go :: locateKeyName`,
# which moves without us; read 2026-10-03): it ends a name at `=` or `:`, and drops a leading `export`.
@pytest.mark.parametrize(
    "line",
    [
        pytest.param("AUTH_SECRET: a value no case reads", id="colon"),
        pytest.param("  AUTH_SECRET :a value no case reads", id="colon-spaced"),
        pytest.param("export AUTH_SECRET: a value no case reads", id="export-colon"),
        pytest.param("export AUTH_SECRET=a value no case reads", id="export-equals"),
        pytest.param("export   AUTH_SECRET", id="export-bare"),
    ],
)
def test_a_credential_line_in_any_form_compose_reads_refuses(line: str) -> None:
    body = f"printf '%s\\n' {shlex.quote(line)} > fl_backend/.env\nrefuse_credential_lines fl_backend/.env\necho credential-lines-passed\n"
    code, output, _ = _run(body)

    assert code == 2, output
    assert "fl_backend/.env: AUTH_SECRET" in output, output
    assert "a value no case reads" not in output, output
    assert "credential-lines-passed" not in output, output


def test_a_multi_line_quoted_value_declares_nothing_and_the_line_after_it_is_judged() -> None:
    """Compose reads the middle line as the value's data; the line after the closing quote is a declaration again."""
    text = 'NOTE="first\nAUTH_SECRET: data the value carries\nlast"\nAUTH_SECRET=a value no case reads\n'
    code, output, _ = _run(f"printf '%s' {shlex.quote(text)} > fl_backend/.env\nrefuse_credential_lines fl_backend/.env\n")

    assert code == 2, output
    assert "fl_backend/.env: AUTH_SECRET\n" in output.replace("\r", ""), output
    assert "data the value carries" not in output and "a value no case reads" not in output, output


def test_a_credential_line_behind_a_byte_order_mark_refuses() -> None:
    """Compose drops the mark before parsing (compose-go `dotenv/godotenv.go :: parseWithLookup`, read 2026-10-03)."""
    code, output, _ = _run(
        "printf '\\xef\\xbb\\xbfAUTH_SECRET=a value no case reads\\n' > fl_backend/.env\nrefuse_credential_lines fl_backend/.env\n"
    )

    assert code == 2, output
    assert "fl_backend/.env: AUTH_SECRET" in output, output
    assert "a value no case reads" not in output, output


def test_a_multi_line_quoted_value_every_reader_takes_alike_is_clean() -> None:
    """Next, `parseEnv` and python-dotenv each read this three-line value alike; its middle line opens `word:`."""
    code, output = _env_spellings('NOTE="first line\nhttps://example.org/a\nlast"\nLOG_FORMAT=json\n')

    assert code == 0, output
    assert "judged-clean" in output, output


@pytest.mark.parametrize(
    ("text", "said"),
    [
        pytest.param('NOTE="first\nsecond $base\nlast"\n', "line 2: NOTE's quoted value holds a $", id="dollar-inside"),
        pytest.param('NOTE="first\nsecond\n', "line 1: NOTE's quoted value never closes", id="unclosed"),
        # The credential check reads the colon form's quote as opening a value too, so both read line 2 as data.
        pytest.param('NOTE: "first\nBASE=$base\nlast"\n', "line 2: NOTE's quoted value holds a $", id="opened-by-a-colon-line"),
    ],
)
def test_a_multi_line_quoted_value_the_readers_disagree_on_refuses(text: str, said: str) -> None:
    code, output = _env_spellings(text)

    assert code == 2, output
    assert said in output, output


def test_a_byte_order_mark_refuses_as_a_spelling_and_the_line_is_still_judged() -> None:
    """Compose, python-dotenv 1.2.4 and `@next/env` 16.3.8 drop the mark; `parseEnv`, driven, keeps it in the first name."""
    code, output = _env_spellings("\ufeffAPI_URL=http://backend:8000/$base\nLOG_FORMAT=json\n")

    assert code == 2, output
    assert "line 1 opens with a byte-order mark" in output, output
    assert "line 1: API_URL holds a $" in output, output
    assert "backend:8000" not in output, output


def test_a_byte_order_mark_alone_refuses() -> None:
    code, output = _env_spellings("\ufeffLOG_FORMAT=json\n")

    assert code == 2, output
    assert "line 1 opens with a byte-order mark" in output, output
    assert "json" not in output.replace("LOG_FORMAT", ""), output


def test_the_retired_administrator_list_refuses_naming_it_and_no_address() -> None:
    """No credential, but no service reads it either, and on the local stack no other reader names it before `docker inspect` prints it."""
    body = (
        "mkdir -p fl_frontend\n"
        "printf 'APP_ENV=local\\nALLOWED_ADMIN_EMAILS=vorstand@schule.de\\n' > fl_frontend/.env\n"
        "refuse_credential_lines fl_frontend/.env\necho credential-lines-passed\n"
    )
    code, output, _ = _run(body)

    assert code == 2, output
    assert "fl_frontend/.env: ALLOWED_ADMIN_EMAILS" in output, output
    assert "vorstand@schule.de" not in output, output
    assert "APP_ENV" not in output, output
    assert "credential-lines-passed" not in output, output


# --- each start mode, run whole over an environment file a preflight refuses ------------------------------

# Records each call's arguments, one call a line, and answers every one, `version` included, as a
# daemon that is up would: what the case asserts is which calls were made before the refusal.
RECORDING_DOCKER: Final = '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" >> "${FL_DOCKER_CALLS}"\nexit 0\n'

# `require_platform` reads `uname -s`, so each script runs here as on its own target machine.
UNAME: Final = "#!/usr/bin/env bash\nprintf '%s\\n' \"${FL_UNAME}\"\n"

# Every mode that goes on to start or recreate containers, each with the platform it requires. The
# status and stop modes ask compose before the preflight and create no container.
START_MODES: Final = [
    pytest.param("deploy.sh", "Linux", (), id="deploy"),
    pytest.param("deploy.sh", "Linux", ("sha-0123abc",), id="deploy-pinned"),
    pytest.param("local.sh", "MINGW64_NT-10.0", (), id="local"),
    pytest.param("local.sh", "MINGW64_NT-10.0", ("--fresh",), id="local-fresh"),
    pytest.param("local.sh", "MINGW64_NT-10.0", ("--seed",), id="local-seed"),
]


def _start(script: str, uname: str, args: tuple[str, ...], frontend_env: str) -> tuple[int, str, list[str]]:
    """One start mode, run whole from a checkout of its own.

    Copied, because `_lib.sh` roots every path at its own checkout; the compose files need only
    exist, the stand-in `docker` reading neither.
    """
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    root = new_root("fl-start-")
    for rel in ("lib/_lib.sh", "ops/deploy.sh", "ops/local.sh"):
        (root / "scripts" / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(SCRIPTS / rel, root / "scripts" / rel)
    for rel, text in (
        ("docker-compose.yml", "services: {}\n"),
        ("docker-compose.local.yml", "services: {}\n"),
        ("fl_frontend/.env", frontend_env),
        ("fl_backend/.env", "LOG_FORMAT=json\n"),
    ):
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_bytes(text.encode())
    stubs = root / "stubs"
    stubs.mkdir()
    os.chmod(write_shell(stubs / "docker", RECORDING_DOCKER), 0o755)
    os.chmod(write_shell(stubs / "uname", UNAME), 0o755)
    calls = root / "docker-calls.txt"
    environment = base_env() | {
        "PATH": str(stubs) + os.pathsep + os.environ["PATH"],
        "FL_DOCKER_CALLS": str(calls),
        "FL_UNAME": uname,
    }
    done = run_shell(BASH, root / "scripts" / "ops" / script, *args, env=environment, cwd=root)
    recorded = calls.read_text(encoding="utf-8").splitlines() if calls.exists() else []
    return done.returncode, done.stdout + done.stderr, recorded


@pytest.mark.parametrize(("script", "uname", "args"), START_MODES)
def test_a_credential_line_stops_every_start_before_compose_is_asked_anything(script: str, uname: str, args: tuple[str, ...]) -> None:
    """Written with a colon, the one form the spelling check also refuses, so its remedy reaching the operator first fails this too."""
    code, output, calls = _start(script, uname, args, "APP_ENV=local\nAUTH_SECRET: a value no case reads\n")

    assert code == 2, output
    assert "these lines name a value no service reads from its environment" in output, output
    assert "fl_frontend/.env: AUTH_SECRET" in output, output
    assert "a value no case reads" not in output, output
    # The stand-in answered the daemon check, so a compose call made before the refusal is one it recorded.
    assert any(call.startswith("version") for call in calls), calls
    assert [call for call in calls if call.startswith("compose")] == [], calls


@pytest.mark.parametrize(("script", "uname", "args"), START_MODES)
def test_a_spelling_the_readers_disagree_on_stops_every_start_before_compose_is_asked_anything(
    script: str, uname: str, args: tuple[str, ...]
) -> None:
    code, output, calls = _start(script, uname, args, "APP_ENV=local\nAPI_URL=http://backend:8000/$base\n")

    assert code == 2, output
    assert "line 2: API_URL holds a $" in output, output
    assert any(call.startswith("version") for call in calls), calls
    assert [call for call in calls if call.startswith("compose")] == [], calls


def test_a_file_holding_no_credential_line_passes_in_silence() -> None:
    clean = CREDENTIAL_LINES.replace("mongodb_uri=", "DB_BASE_NAME=").replace("INTERNAL_API_KEY_BASE=", "# ")
    code, output, _ = _run(clean.replace("AUTH_SECRET", "AUTH_URL"))

    assert code == 0, output
    assert "credential-lines-passed" in output, output
    assert "!!" not in output, output


def test_the_moved_names_are_the_secret_files_names() -> None:
    """Each moved name is a file's under the same name upper-cased, the two database logins sharing one."""
    files = {name.upper() for name in _lib_array("FRONTEND_SECRETS") + _lib_array("BACKEND_SECRETS")}
    renamed = {name.replace("FRONTEND_", "").replace("BACKEND_", "") for name in files}

    assert set(_lib_array("MOVED_ENV_NAMES")) == renamed


# --- compose's own `.env`, beside the compose file -----------------------------------------------------

STRAY: Final = """printf 'COMPOSE_PROJECT_NAME=a value no case reads\\n' > .env
refuse_compose_dotenv
echo stray-passed
"""


def test_a_dotenv_beside_the_compose_file_refuses_naming_the_file_and_no_line_of_it() -> None:
    code, output, _ = _run(STRAY)

    assert code == 2, output
    assert "stray-passed" not in output, output
    assert "/.env" in output, output
    assert "COMPOSE_PROJECT_NAME" not in output, output
    assert "a value no case reads" not in output, output


def test_a_checkout_without_one_passes_in_silence() -> None:
    code, output, _ = _run(STRAY.split("\n", 1)[1])

    assert code == 0, output
    assert output.strip() == "stray-passed", output


@pytest.mark.parametrize(
    ("script", "first_mode"),
    [(DEPLOY, "\nif (( STATUS_ONLY )); then\n"), (LOCAL, "\nif (( DOWN )); then\n")],
    ids=["deploy", "local"],
)
def test_each_script_refuses_one_before_any_mode_asks_compose(script: Path, first_mode: str) -> None:
    """`--status` and `--down` branch off before the preflight, and a renamed project aims them at another stack too."""
    text = script.read_text(encoding="utf-8")

    assert text.index("\nrefuse_compose_dotenv\n") < text.index(first_mode), script.name


# --- the mail sink a start empties -------------------------------------------------------------------

# Compose's model as `docker compose config --format json` prints it, its frontend's sink mounted from
# `$1` relative to the fixture's checkout and spelled as the platform spells a path, which on Windows
# is the JSON-escaped drive form `empty_mail_sink` reads back.
SINK_MODEL: Final = """sink_model() {
  local source="$PWD/$1"
  if command -v cygpath >/dev/null 2>&1; then source="$(cygpath -w "$source")"; source="${source//\\\\/\\\\\\\\}"; fi
  printf '{\n  "services": {\n    "frontend": {\n      "volumes": [\n        {\n          "type": "bind",\n'
  printf '          "source": "%s",\n          "target": "/app/.tmp-mail",\n' "$source"
  printf '          "bind": {}\n        }\n      ]\n    }\n  }\n}\n'
}
"""

SINK: Final = (
    SINK_MODEL + 'REPO_ROOT="$PWD"\n' + f"{lift_assignment(LOCAL, 'MAIL_SINK_TARGET')}\n" + f"{lift_function(LOCAL, 'empty_mail_sink')}\n"
)

FILED: Final = ("2026-10-02T07-15-30.123Z-dein-anmeldecode.html", "2026-10-02T07-15-30.123Z-dein-anmeldecode-2.html")


def test_a_start_removes_every_message_an_earlier_run_filed_and_nothing_else() -> None:
    """A code an earlier run filed reads as current beside this run's, and the sink is the developer's directory too."""
    body = SINK + (
        "mkdir -p .tmp-mail\n"
        + "".join(f"printf x > .tmp-mail/{name}\n" for name in FILED)
        + "printf x > .tmp-mail/notizen.txt\nprintf x > .tmp-mail/behalten.html\n"
        + 'export FL_DEPLOY_CONFIG_SAYS="$(sink_model .tmp-mail)"\n'
        + "empty_mail_sink\nls .tmp-mail\n"
    )
    code, output, fixture = _run(body)

    assert code == 0, output
    assert "2 message(s) an earlier run filed removed" in output, output
    assert sorted(path.name for path in (fixture.root / "checkout" / ".tmp-mail").iterdir()) == ["behalten.html", "notizen.txt"], output


def test_a_sink_compose_mounts_from_outside_the_checkout_is_refused_and_never_made() -> None:
    body = SINK + 'export FL_DEPLOY_CONFIG_SAYS="$(sink_model ../anderswo)"\nempty_mail_sink\necho sink-emptied\n'
    code, output, fixture = _run(body)

    assert code == 2, output
    assert "outside the checkout" in output, output
    assert "sink-emptied" not in output, output
    assert not (fixture.root / "anderswo").exists(), "the refused directory was created"


def test_a_sink_outside_the_checkout_keeps_every_file_in_it() -> None:
    body = SINK + (
        "mkdir -p ../anderswo\n"
        + f"printf x > ../anderswo/{FILED[0]}\n"
        + 'export FL_DEPLOY_CONFIG_SAYS="$(sink_model ../anderswo)"\nempty_mail_sink\n'
    )
    code, output, fixture = _run(body)

    assert code == 2, output
    assert (fixture.root / "anderswo" / FILED[0]).exists(), "a file outside the checkout was removed"


def test_a_model_mounting_no_sink_is_refused_naming_the_mount() -> None:
    body = SINK + "export FL_DEPLOY_CONFIG_SAYS='{\"services\": {}}'\nempty_mail_sink\necho sink-emptied\n"
    code, output, _ = _run(body)

    assert code == 2, output
    assert "mounts nothing at /app/.tmp-mail" in output, output
    assert "sink-emptied" not in output, output


def test_every_start_empties_the_sink_before_the_build() -> None:
    """At the top level, past `--down`'s exit: the call also creates the sink, which the engine would otherwise mount root-owned."""
    text = LOCAL.read_text(encoding="utf-8")

    assert text.index("\nif (( DOWN )); then\n") < text.index("\nempty_mail_sink\n") < text.index('\nsection "build"\n'), LOCAL.name


# --- the copy of production a development machine takes -----------------------------------------------

DUMP: Final = (
    "printf 'DB_BASE_NAME=league\\nA_NAME=a value no case reads\\n' > fl_backend/.env\n"
    f"{lift_assignment(LOCAL, 'DUMP_URI_FILE')}\n"
    'DUMP_LOG="dump.log"\n'
    f"{lift_function(LOCAL, 'take_dump')}\n"
    "take_dump\n"
)


def test_the_copy_is_handed_the_read_only_login_s_file_and_the_database_s_name_alone() -> None:
    """No development machine holds production's write login, so the copy reads `secrets/dump_mongodb_uri` and no environment file whole."""
    code, output, fixture = _run(DUMP)
    argv = fixture.argv.read_text(encoding="utf-8").splitlines()

    assert code == 0, output
    assert "--env-file" not in argv, argv
    assert argv[argv.index("-e") + 1] == "DB_BASE_NAME", argv
    mounts = [argv[i + 1] for i, arg in enumerate(argv) if arg == "-v"]
    assert [mount for mount in mounts if mount.endswith(":/run/secrets/dump_mongodb_uri:ro")], mounts
    assert not [mount for mount in mounts if "/secrets:" in mount or ".env" in mount], mounts
