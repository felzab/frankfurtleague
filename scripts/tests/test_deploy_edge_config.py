"""SCRIPTS · what `scripts/ops/deploy.sh` establishes about the edge: its images, and the configuration it reloads.

nginx's Control API answers a reload 200 or 422 and dumps the configuration its master holds, where
a signal answers 0 once sent and the mounts show what a pull wrote whether or not anything loaded
it. The functions are lifted out and driven behind a stand-in `docker` whose `exec` answers as that
API over a fixture's loaded files, and whose `run` hands the deploy's own decoder to this suite's
interpreter, so what is compared is the deploy's reading and not a copy of it.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
from pathlib import Path
from typing import Final

from conftest import base_env, import_scripts, lift_function, new_root, run_shell, write_shell

[exposure] = import_scripts("check_compose_exposure")

SCRIPTS: Final = Path(__file__).resolve().parent.parent
LIB: Final = SCRIPTS / "lib" / "_lib.sh"
DEPLOY: Final = SCRIPTS / "ops" / "deploy.sh"

# Not a skip condition, for `scripts/tests/test_exit_contract.py :: BASH`'s reason.
BASH: Final = shutil.which("bash")

# `ps` answers one container id, or a second from the second ask where `up` recreated nginx. A
# PATCH is the reload; any other `exec` is the dump, refused for the first `FL_EDGE_GET_FAILS` asks
# as a socket not yet open.
STUB: Final = r"""#!/usr/bin/env bash
set -u
state="${FL_EDGE_STATE}"
case "${1:-}" in
  compose) ;;
  run)
    # A decode that could pull an image or reach a network, which `--status` must never do.
    if [[ " $* " != *" --pull never "* || " $* " != *" --network none "* ]]; then
      echo "stand-in: a decode without --pull never and --network none: $*" >&2
      exit 99
    fi
    if [[ -n "${FL_EDGE_RUN_RC:-}" ]]; then exit "${FL_EDGE_RUN_RC}"; fi
    while (( $# )) && [[ "$1" != "python" ]]; do shift; done
    shift
    # A Windows interpreter's stdout is text mode, and the image's is Linux's.
    "${FL_EDGE_PYTHON}" "$@" | tr -d '\r'
    exit "${PIPESTATUS[0]}" ;;
  *) exit 0 ;;
esac
case " $* " in
  *" pull "*)
    printf '%s\n' "$@" > "${state}/pull-argv"
    if [[ -n "${FL_EDGE_PULL_RC:-}" ]]; then echo "stand-in: manifest unknown" >&2; exit "${FL_EDGE_PULL_RC}"; fi
    exit 0 ;;
  *" ps "*)
    n=$(( $(cat "${state}/ps-count" 2>/dev/null || echo 0) + 1 ))
    echo "$n" > "${state}/ps-count"
    if [[ -n "${FL_EDGE_RECREATED:-}" ]] && (( n > 1 )); then echo cid-new; else echo cid-old; fi
    exit 0 ;;
  *" up "*) exit 0 ;;
  *" -X PATCH "*)
    touch "${state}/reloaded"
    if [[ -n "${FL_EDGE_CONTROL_RC:-}" ]]; then exit "${FL_EDGE_CONTROL_RC}"; fi
    printf '%s\n%s' "${FL_EDGE_RELOAD_BODY}" "${FL_EDGE_RELOAD_STATUS}"
    exit 0 ;;
esac
if [[ -n "${FL_EDGE_CONTROL_RC:-}" ]]; then exit "${FL_EDGE_CONTROL_RC}"; fi
n=$(( $(cat "${state}/get-count" 2>/dev/null || echo 0) + 1 ))
echo "$n" > "${state}/get-count"
if (( n <= ${FL_EDGE_GET_FAILS:-0} )); then exit 7; fi
cat "${state}/loaded.json"
"""

# A non-ASCII line and a tab, which the dump escapes and the decoder has to hand back byte for byte.
PROD: Final = "# the production edge, as this checkout holds it — Kürzel\tand a tab\n".encode()
HTTP: Final = b"# the http level both edges share\n"
SITE: Final = b"# the server body both edges share\n"
CHECKOUT: Final = {"nginx/prod/prod.conf": PROD, "nginx/shared/http.conf": HTTP, "nginx/shared/site.conf": SITE}
# What an nginx loading the checkout above through `scripts/ops/deploy.sh :: EDGE_CONFIG_DIRS` holds,
# the image's own two files included, which sit outside every mount and are never compared.
CURRENT: Final = {
    "/etc/nginx/nginx.conf": b"# the image's own\n",
    "/etc/nginx/mime.types": b"types {}\n",
    "/etc/nginx/conf.d/prod.conf": PROD,
    "/etc/nginx/shared/http.conf": HTTP,
    "/etc/nginx/shared/site.conf": SITE,
}

APPLIED: Final = {"FL_EDGE_RELOAD_STATUS": "200", "FL_EDGE_RELOAD_BODY": '{"logs":[]}'}
REFUSED: Final = {
    "FL_EDGE_RELOAD_STATUS": "422",
    "FL_EDGE_RELOAD_BODY": '{"logs":["[emerg] 1#1: unknown directive \\"proxy_passs\\" in /etc/nginx/shared/site.conf:3\\n"]}',
}

RELOAD: Final = """rc=0
serve_through_nginx || rc=$?
printf 'rc=%s\\n' "$rc"
if [[ -f "${FL_EDGE_STATE}/reloaded" ]]; then echo reloaded=yes; else echo reloaded=no; fi
"""


def _assignment(name: str) -> str:
    """One assignment out of the script, read rather than restated: an array on one line, or a quoted value."""
    text = DEPLOY.read_text(encoding="utf-8")
    found = re.search(rf"""^{name}=(\(.*\)|"[^"\n]*"|'[^']*')$""", text, re.MULTILINE)
    assert found is not None, f"scripts/ops/deploy.sh assigns no {name}"
    return found.group(0)


def _run(loaded: dict[str, bytes], body: str = RELOAD, **overrides: str) -> str:
    """The lifted functions behind the stand-in, from a checkout holding `CHECKOUT` and an nginx holding `loaded`."""
    assert BASH is not None, "no bash on PATH -- every script in scripts/ needs one"
    root = new_root("fl-deploy-edge-")
    checkout = root / "checkout"
    for rel, content in CHECKOUT.items():
        path = checkout / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    state = root / "state"
    state.mkdir()
    # The API's own shape (`GET /1/control/config`): an array of every file's name and content.
    dump = [{"name": name, "content": content.decode()} for name, content in loaded.items()]
    (state / "loaded.json").write_bytes(json.dumps(dump).encode())
    stubs = root / "stubs"
    stubs.mkdir()
    # The execute bit is what puts this ahead of a real daemon on PATH.
    os.chmod(write_shell(stubs / "docker", STUB), 0o755)
    environment = base_env()
    environment["PATH"] = str(stubs) + os.pathsep + environment["PATH"]
    environment["FL_EDGE_STATE"] = state.as_posix()
    environment["FL_EDGE_PYTHON"] = Path(sys.executable).as_posix()
    environment.update(overrides)
    lines = (
        "#!/usr/bin/env bash",
        f'source "{LIB.as_posix()}"',
        # `_lib.sh` cd's to this repository as it is sourced, whose own `nginx/` would be compared.
        f'cd "{checkout.as_posix()}"',
        'COMPOSE="docker-compose.yml"',
        _assignment("EDGE_CONFIG_DIRS"),
        _assignment("EDGE_CONTROL_SOCKET"),
        _assignment("EDGE_IMAGE_SERVICES"),
        _assignment("EDGE_LOADED_SUMS"),
        _assignment("EDGE_RELOAD_LOGS"),
        # Three polls rather than the script's own count: a case whose socket never opens waits them out.
        "EDGE_START_POLLS=3",
        *(
            lift_function(DEPLOY, name)
            for name in (
                "service_cid",
                "edge_control",
                "decode_json",
                "edge_control_opened",
                "edge_reads_checkout",
                "serve_through_nginx",
                "fetch_edge_images",
            )
        ),
        body,
        "",
    )
    done = run_shell(BASH, write_shell(root / "parent.sh", "\n".join(lines)), env=environment, cwd=checkout)
    return done.stdout + done.stderr


# --- the reload, and what the edge holds afterwards ---------------------------------------------------


def test_an_edge_holding_the_checkout_after_an_applied_reload_passes() -> None:
    """The fixture carries a non-ASCII line and a tab, so a decoder that re-encodes either reads as a difference."""
    output = _run(CURRENT, **APPLIED)

    assert "rc=0" in output, output
    assert "reloaded=yes" in output, output
    assert "holds this checkout's 3 configuration files" in output, output


def test_a_file_the_pull_replaced_under_a_running_edge_fails_naming_the_recreate() -> None:
    """The defect itself: the reload applied, and what nginx holds is still the file the pull replaced."""
    stale = {**CURRENT, "/etc/nginx/conf.d/prod.conf": b"# the production edge before the pull\n"}
    output = _run(stale, **APPLIED)

    assert "rc=1" in output, output
    assert "reloaded=yes" in output, output
    assert "/etc/nginx/conf.d/prod.conf  differs from this checkout's" in output, output
    assert "up -d --force-recreate nginx" in output, output


def test_an_edge_still_on_the_single_file_mount_fails_on_both_names() -> None:
    """A container created before the directory mount holds `default.conf`, which no checkout file maps to."""
    old = {**CURRENT, "/etc/nginx/conf.d/default.conf": PROD}
    del old["/etc/nginx/conf.d/prod.conf"]
    output = _run(old, **APPLIED)

    assert "rc=1" in output, output
    assert "/etc/nginx/conf.d/default.conf  in the running nginx and not in this checkout" in output, output
    assert "/etc/nginx/conf.d/prod.conf  absent from the running nginx" in output, output


def test_a_shared_file_missing_from_the_edge_fails() -> None:
    loaded = {name: content for name, content in CURRENT.items() if name != "/etc/nginx/shared/site.conf"}
    output = _run(loaded, **APPLIED)

    assert "rc=1" in output, output
    assert "/etc/nginx/shared/site.conf  absent from the running nginx" in output, output


def test_an_edge_that_cannot_be_asked_is_unestablished_rather_than_a_pass() -> None:
    """A refused reload is a different answer; this one is the API not reached at all, reload included."""
    output = _run(CURRENT, FL_EDGE_CONTROL_RC="7", **APPLIED)

    assert "rc=2" in output, output
    assert "(exit 7)" in output, output
    assert "byte for byte" not in output, output


def test_a_dump_the_decoder_cannot_read_is_unestablished_rather_than_a_pass() -> None:
    output = _run(CURRENT, FL_EDGE_RUN_RC="125", **APPLIED)

    assert "rc=2" in output, output
    assert "(exit 125)" in output, output
    assert "byte for byte" not in output, output


def test_a_reload_the_master_refused_fails_with_its_own_lines_before_any_file_is_compared() -> None:
    """The remedy is the one `docs/ops/spec.md` §3 gives: nginx's lines, a fix, then a recreate."""
    output = _run(CURRENT, **REFUSED)

    assert "rc=1" in output, output
    assert "reloaded=yes" in output, output
    # Decoded: the quotes nginx wrote, not the reply's escaped ones.
    assert 'unknown directive "proxy_passs" in /etc/nginx/shared/site.conf:3' in output, output
    assert "Fix nginx/prod/ or nginx/shared/ as they say, then recreate it" in output, output
    assert "byte for byte" not in output, output


def test_a_reload_answered_neither_applied_nor_refused_is_unestablished() -> None:
    output = _run(CURRENT, FL_EDGE_RELOAD_STATUS="500", FL_EDGE_RELOAD_BODY="")

    assert "rc=2" in output, output
    assert "answered the reload with '500'" in output, output
    assert "byte for byte" not in output, output


def test_a_recreated_edge_is_compared_too() -> None:
    """No reload runs where the `up` replaced nginx, and the dump is what says it loaded this checkout."""
    stale = {**CURRENT, "/etc/nginx/shared/site.conf": b"# a body no checkout holds\n"}
    output = _run(stale, FL_EDGE_RECREATED="1", **APPLIED)

    assert "rc=1" in output, output
    assert "reloaded=no" in output, output
    assert "/etc/nginx/shared/site.conf  differs from this checkout's" in output, output


def test_a_recreated_edge_is_given_time_to_open_its_socket() -> None:
    """The `up` returns before nginx listens, so the first asks meet no socket; this is every deploy changing nginx's own definition."""
    output = _run(CURRENT, FL_EDGE_RECREATED="1", FL_EDGE_GET_FAILS="2", **APPLIED)

    assert "rc=0" in output, output
    assert "holds this checkout's 3 configuration files" in output, output


def test_the_status_report_compares_the_edge_as_well() -> None:
    """`--status` answers "what is live", and a probe answered 200 by a configuration no pull reached reads as current."""
    text = DEPLOY.read_text(encoding="utf-8")
    status = text[text.index("if (( STATUS_ONLY )); then\n  section") : text.index('section "preflight"')]

    assert "edge_reads_checkout" in status, "scripts/ops/deploy.sh --status never compares the edge's configuration"


# --- the edge's images, fetched before anything the application runs moves ---------------------------

FETCH: Final = """( fetch_edge_images ) || rc=$?
printf 'rc=%s\\n' "${rc:-0}"
if [[ -f "${FL_EDGE_STATE}/pull-argv" ]]; then printf 'argv=%s\\n' "$(tr '\\n' ' ' < "${FL_EDGE_STATE}/pull-argv")"; fi
"""


def _argv(output: str) -> list[str]:
    found = re.search(r"^argv=(.*)$", output, re.MULTILINE)
    assert found is not None, output
    return found.group(1).split()


def test_every_image_the_application_pair_does_not_run_is_fetched_where_missing() -> None:
    """Held to production's declared services, so one joining them is fetched before the recreate too.

    `missing` is the policy `up` applies; `--include-deps` would reach nginx's dependencies and refresh
    the application's `:latest` over a pin.
    """
    output = _run(CURRENT, FETCH)
    argv = _argv(output)

    assert "rc=0" in output, output
    assert argv[:4] == ["compose", "-f", "docker-compose.yml", "pull"], argv
    assert argv[argv.index("--policy") + 1] == "missing", argv
    assert "--include-deps" not in argv, argv
    assert set(argv[argv.index("--policy") + 2 :]) == exposure.PRODUCTION_SERVICES - {"frontend", "backend"}, argv


def test_a_fetch_that_fails_refuses_before_any_application_image_is_pulled() -> None:
    output = _run(CURRENT, FETCH, FL_EDGE_PULL_RC="18")

    assert "rc=2" in output, output
    assert "(exit 18)" in output, output
    assert "No application image has been pulled, NOTHING has been recreated" in output, output
    # Compose's own reason, which the refusal sends the operator to.
    assert "manifest unknown" in output, output


def test_the_edge_images_are_fetched_before_either_application_image_or_the_recreate() -> None:
    text = DEPLOY.read_text(encoding="utf-8")
    fetched = text.index("\nfetch_edge_images\n")

    assert text.index("\ncheck_compose_config\n") < fetched, "the edge's images are fetched before compose's configuration is read"
    for later in ('docker pull "${REPO_FRONTEND}:${PIN}"', 'docker pull "$IMAGE_FRONTEND"', 'step "Recreating the application containers"'):
        assert fetched < text.index(later), f"scripts/ops/deploy.sh fetches the edge's images after {later}"
