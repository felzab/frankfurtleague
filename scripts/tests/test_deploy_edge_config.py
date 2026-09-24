"""SCRIPTS · what `scripts/ops/deploy.sh :: serve_through_nginx` establishes about the edge it reloads.

`nginx -s reload` answers 0 once the signal is sent, and re-reads whatever the container's mounts
show: a file mount keeps the file it was created with, so a pull's replacement never reaches it. The
functions are lifted out and driven behind a stand-in `docker` whose `exec` runs the script the
deploy sends against a directory standing in for the container's `/etc/nginx`, so what is compared
is the deploy's own reading and not a copy of it.

Invariants:
  The compose files mount the edge's configuration as the directories `scripts/ops/deploy.sh :: EDGE_CONFIG_DIRS` names.
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

# Not a skip condition, for `scripts/tests/test_exit_contract.py :: BASH`'s reason.
BASH: Final = shutil.which("bash")

# `ps` answers one container id, or a second from the second ask on where the `up` recreated nginx.

# `exec` runs the deploy's `sh -c` script over the fixture's edge directory, mapping the paths back
# and writing busybox's `<sum>  <path>` where a Windows sha256sum writes `<sum> *<path>`.
STUB: Final = r"""#!/usr/bin/env bash
set -u
state="${FL_EDGE_STATE}"
[[ "${1:-}" == "compose" ]] || exit 0
case " $* " in
  *" ps "*)
    n=$(( $(cat "${state}/ps-count" 2>/dev/null || echo 0) + 1 ))
    echo "$n" > "${state}/ps-count"
    if [[ -n "${FL_EDGE_RECREATED:-}" ]] && (( n > 1 )); then echo cid-new; else echo cid-old; fi
    exit 0 ;;
  *" up "*) exit 0 ;;
esac
cmd=(); seen=0
for arg in "$@"; do
  if (( seen == 2 )); then cmd+=("$arg"); continue; fi
  if [[ "$arg" == "exec" ]]; then seen=1; continue; fi
  if (( seen == 1 )) && [[ "$arg" == "nginx" ]]; then seen=2; fi
done
case "${cmd[0]:-}" in
  nginx)
    if [[ "${cmd[1]:-}" == "-t" ]]; then echo "nginx: configuration file /etc/nginx/nginx.conf test is successful" >&2; exit 0; fi
    touch "${state}/reloaded"
    exit "${FL_EDGE_RELOAD_RC:-0}" ;;
  pgrep)
    if [[ -n "${FL_EDGE_WORKERS_RC:-}" ]]; then exit "${FL_EDGE_WORKERS_RC}"; fi
    if [[ -f "${state}/reloaded" && -n "${FL_EDGE_RELOAD_APPLIES:-}" ]]; then printf '11\n12\n21\n22\n'; else printf '11\n12\n'; fi
    exit 0 ;;
  sh)
    if [[ -n "${FL_EDGE_EXEC_RC:-}" ]]; then exit "${FL_EDGE_EXEC_RC}"; fi
    script="${cmd[2]//\/etc\/nginx\//${FL_EDGE_ROOT}/}"
    rc=0
    out="$(sh -c "$script")" || rc=$?
    if [[ -n "$out" ]]; then printf '%s\n' "$out" | sed -e "s# \*# #" -e "s#${FL_EDGE_ROOT}/#/etc/nginx/#"; fi
    exit "$rc" ;;
esac
exit 0
"""

PROD: Final = b"# the production edge, as this checkout holds it\n"
HTTP: Final = b"# the http level both edges share\n"
SITE: Final = b"# the server body both edges share\n"
CHECKOUT: Final = {"nginx/prod/prod.conf": PROD, "nginx/shared/http.conf": HTTP, "nginx/shared/site.conf": SITE}
# What a container mounting the checkout above as `scripts/ops/deploy.sh :: EDGE_CONFIG_DIRS` pairs it sees.
CURRENT: Final = {"conf.d/prod.conf": PROD, "shared/http.conf": HTTP, "shared/site.conf": SITE}

RELOAD: Final = """rc=0
serve_through_nginx || rc=$?
printf 'rc=%s\\n' "$rc"
if [[ -f "${FL_EDGE_STATE}/reloaded" ]]; then echo reloaded=yes; else echo reloaded=no; fi
"""


def _assignment(name: str) -> str:
    """One array assignment out of the script, read rather than restated."""
    found = re.search(rf"^{name}=\(.*\)$", DEPLOY.read_text(encoding="utf-8"), re.MULTILINE)
    assert found is not None, f"scripts/ops/deploy.sh assigns no {name} array on one line"
    return found.group(0)


def _write(root: Path, files: dict[str, bytes]) -> None:
    for rel, content in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)


def _run(edge: dict[str, bytes], body: str = RELOAD, **overrides: str) -> str:
    """The lifted functions behind the stand-in, from a checkout holding `CHECKOUT` and an edge holding `edge`."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    root = new_root("fl-deploy-edge-")
    checkout = root / "checkout"
    _write(checkout, CHECKOUT)
    # The edge's directories exist even where the case leaves one empty, as a mount's would.
    for directory in ("conf.d", "shared"):
        (root / "edge" / directory).mkdir(parents=True)
    _write(root / "edge", edge)
    state = root / "state"
    state.mkdir()
    stubs = root / "stubs"
    stubs.mkdir()
    # The execute bit is what puts this ahead of a real daemon on PATH.
    os.chmod(write_shell(stubs / "docker", STUB), 0o755)
    environment = base_env()
    environment["PATH"] = str(stubs) + os.pathsep + environment["PATH"]
    environment["FL_EDGE_ROOT"] = (root / "edge").as_posix()
    environment["FL_EDGE_STATE"] = state.as_posix()
    environment.update(overrides)
    lines = (
        "#!/usr/bin/env bash",
        f'source "{LIB.as_posix()}"',
        # `_lib.sh` cd's to this repository as it is sourced, whose own `nginx/` would be compared.
        f'cd "{checkout.as_posix()}"',
        'COMPOSE="docker-compose.yml"',
        _assignment("EDGE_CONFIG_DIRS"),
        # Two polls rather than the script's own count: a case whose reload never applies waits them out.
        "EDGE_APPLY_POLLS=2",
        *(
            lift_function(DEPLOY, name)
            for name in ("service_cid", "edge_workers", "edge_new_generation", "edge_reads_checkout", "serve_through_nginx")
        ),
        body,
        "",
    )
    done = run_shell(BASH, write_shell(root / "parent.sh", "\n".join(lines)), env=environment, cwd=checkout)
    return done.stdout + done.stderr


# --- the reload, and what the edge reads afterwards ---------------------------------------------------


def test_an_edge_reading_the_checkout_after_an_applied_reload_passes() -> None:
    output = _run(CURRENT, FL_EDGE_RELOAD_APPLIES="1")

    assert "rc=0" in output, output
    assert "reloaded=yes" in output, output
    assert "loads this checkout's 3 configuration files" in output, output


def test_a_file_the_pull_replaced_under_a_running_edge_fails_naming_the_recreate() -> None:
    """The defect itself: the reload applied, from a mount still showing the file the pull replaced."""
    stale = {**CURRENT, "conf.d/prod.conf": b"# the production edge before the pull\n"}
    output = _run(stale, FL_EDGE_RELOAD_APPLIES="1")

    assert "rc=1" in output, output
    assert "reloaded=yes" in output, output
    assert "/etc/nginx/conf.d/prod.conf  differs from this checkout's" in output, output
    assert "up -d --force-recreate nginx" in output, output


def test_an_edge_still_on_the_single_file_mount_fails_on_both_names() -> None:
    """A container created before the directory mount holds `default.conf`, which no checkout file maps to."""
    old = {"conf.d/default.conf": PROD, "shared/http.conf": HTTP, "shared/site.conf": SITE}
    output = _run(old, FL_EDGE_RELOAD_APPLIES="1")

    assert "rc=1" in output, output
    assert "/etc/nginx/conf.d/default.conf  in the running nginx and not in this checkout" in output, output
    assert "/etc/nginx/conf.d/prod.conf  absent from the running nginx" in output, output


def test_a_shared_file_missing_from_the_edge_fails() -> None:
    output = _run({"conf.d/prod.conf": PROD, "shared/http.conf": HTTP}, FL_EDGE_RELOAD_APPLIES="1")

    assert "rc=1" in output, output
    assert "/etc/nginx/shared/site.conf  absent from the running nginx" in output, output


def test_an_edge_that_cannot_be_read_is_unestablished_rather_than_a_pass() -> None:
    output = _run(CURRENT, FL_EDGE_RELOAD_APPLIES="1", FL_EDGE_EXEC_RC="126")

    assert "rc=2" in output, output
    assert "(exit 126)" in output, output
    assert "byte for byte" not in output, output


def test_a_reload_the_master_rolled_back_fails_before_any_file_is_compared() -> None:
    """`nginx -s reload` answered 0 here: only the unchanged worker set says the configuration never applied."""
    output = _run(CURRENT)

    assert "rc=1" in output, output
    assert "reloaded=yes" in output, output
    assert "still running only the workers it had before" in output, output
    assert "logs --tail 20 nginx" in output, output
    assert "byte for byte" not in output, output


def test_workers_that_cannot_be_listed_still_get_the_reload_and_answer_unestablished() -> None:
    """The replaced containers' addresses answer 502 until the signal lands, so an unread list never withholds it."""
    output = _run(CURRENT, FL_EDGE_RELOAD_APPLIES="1", FL_EDGE_WORKERS_RC="1")

    assert "rc=2" in output, output
    assert "reloaded=yes" in output, output


def test_a_recreated_edge_is_compared_too() -> None:
    """No reload runs where the `up` replaced nginx, and the comparison is what says it mounted this checkout."""
    stale = {**CURRENT, "shared/site.conf": b"# a body no checkout holds\n"}
    output = _run(stale, FL_EDGE_RECREATED="1")

    assert "rc=1" in output, output
    assert "reloaded=no" in output, output
    assert "/etc/nginx/shared/site.conf  differs from this checkout's" in output, output


def test_the_status_report_compares_the_edge_as_well() -> None:
    """`--status` answers "what is live", and a probe answered 200 by a configuration no pull reached reads as current."""
    text = DEPLOY.read_text(encoding="utf-8")
    status = text[text.index("if (( STATUS_ONLY )); then\n  section") : text.index('section "preflight"')]

    assert "edge_reads_checkout" in status, "scripts/ops/deploy.sh --status never compares the edge's configuration"


# --- the mounts the comparison assumes ---------------------------------------------------------------


def _nginx_volumes(compose: Path) -> list[tuple[str, str]]:
    """The nginx service's `./nginx/...` volumes as (source, target), read off the file's own lines."""
    lines = compose.read_text(encoding="utf-8").splitlines()
    start = lines.index("  nginx:")
    end = next(i for i in range(start + 1, len(lines)) if re.match(r"^  \S", lines[i]))
    found = [re.match(r"^\s+- \./(nginx/[^:]*):([^:]+)(:ro)?$", line) for line in lines[start:end]]
    return [(match.group(1), match.group(2)) for match in found if match]


def test_production_mounts_exactly_the_directories_the_comparison_reads() -> None:
    """A pair here and not in the script is configuration the deploy never compares, and the reverse fails every deploy."""
    pairs = re.findall(r'"([^":]+):([^"]+)"', _assignment("EDGE_CONFIG_DIRS"))

    assert _nginx_volumes(REPO_ROOT / "docker-compose.yml") == pairs


def test_every_nginx_config_mount_on_either_stack_is_a_directory() -> None:
    """A file mount keeps the inode it was created with, so a reload after a pull re-reads the replaced file."""
    for compose in ("docker-compose.yml", "docker-compose.local.yml"):
        volumes = _nginx_volumes(REPO_ROOT / compose)

        assert volumes, f"{compose} mounts nothing from nginx/ into its nginx service"
        for source, target in volumes:
            assert (REPO_ROOT / source).is_dir(), f"{compose} mounts {source} at {target}, which is not a directory"
