"""SCRIPTS · what the backend's declaration argues from, held to the tree it names.

A reason is read as evidence, so one arguing from a rule, an invariant, a route or a file renamed away
reads as evidence and is none. The declaration is imported rather than read as text: its value is
what the application runs with, whatever spelling builds it.

Invariants:
  Every backticked token of a reason resolves here, by its shape, or fails; the backend's own suite
  holds the declaration's claims and never its addresses.
"""

from __future__ import annotations

import importlib
import json
import re
import sys
from collections.abc import Callable
from functools import cache
from types import ModuleType
from typing import Final, NamedTuple

from .kernel import (
    REPO_ROOT,
    Finding,
    _read_text,
    _readable,
    code_body,
    is_gitignored,
    repo_path,
    tracked_glob,
    tracked_page,
)

BACKEND_ROOT: Final = "fl_backend"
DOMAIN_MODULE: Final = "fl_backend/app/core/domain.py"
# The one sheet holding the read rules, which refuse nothing and so reach no module's source.
READ_RULES_SHEET: Final = "docs/backend/spec.md"
APP_GLOB: Final = "fl_backend/app/**/*.py"
OPENAPI_PAGE: Final = "fl_backend/openapi.json"
PAGE_GLOB: Final = "fl_frontend/src/app/**/page.tsx"
APP_DIR: Final = "fl_frontend/src/app/"
# The trees a bare name is looked for in: a field, a symbol, an index or a label a page prints.
NAME_GLOBS: Final = (APP_GLOB, "fl_frontend/src/**/*.ts", "fl_frontend/src/**/*.tsx", "fl_frontend/src/**/*.css")

REASON_TOKEN_RE: Final = re.compile(r"`([^`]+)`")
RULE_CODE_RE: Final = re.compile(r"^(?:REQ|READ)-[A-Z]+-\d+$")
CODE_FAMILY_RE: Final = re.compile(r"^((?:REQ|READ)-[A-Z]+-)\*$")
CITATION_RE: Final = re.compile(r"^(\S+\.\w+) :: (.+)$")
REPO_PATH_RE: Final = re.compile(r"^[\w.\-]+(?:/[\w.\-]*)+$")
INVARIANT_RE: Final = re.compile(r"^[IL]\d{1,3}[a-z]?$")
ENDPOINT_RE: Final = re.compile(r"^(GET|POST|PUT|PATCH|DELETE) (/\S*)$")
SURFACE_RE: Final = re.compile(r"^/\S*$")
INDEX_KEY_RE: Final = re.compile(r"^\(([a-z_]+(?:, [a-z_]+)+)\)$")
NAME_RE: Final = re.compile(r"^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$")
WORD_RE: Final = re.compile(r"[A-Za-z_]\w*")
# The kinds that name no address, spared by shape and never by a list of tokens: a stored value, a
# field beside the value it holds, and a type expression.
SPARED_RES: Final = (re.compile(r"^\d+$"), re.compile(r"^[\w.]+: \S+$"), re.compile(r"^[\w\[\], |]*[\[|][\w\[\], |]*$"))
# A folder Next.js leaves out of the URL (https://nextjs.org/docs/app/api-reference/file-conventions/route-groups).
ROUTE_GROUP_RE: Final = re.compile(r"^\(.+\)$")

RAISED_CODE_RE: Final = re.compile(r"\bREQ-[A-Z]+-\d+\b")
READ_ROW_RE: Final = re.compile(r"^\| `(READ-[A-Z]+-\d+)` ", re.MULTILINE)

# `rel`, then the citation, then the invariant tables: `checks.py :: _check_citation`'s signature,
# handed in because that module imports this one.
Cite = Callable[[str, str, dict[str, list[str]]], list[Finding]]


class Backend(NamedTuple):
    domain: ModuleType
    constraints: ModuleType
    config: ModuleType


@cache
def backend() -> Backend | str:
    """The backend's declarations as the application runs them, or why they could not be imported.

    Any `app` a host process already holds is dropped first: this reads the backend at `REPO_ROOT`.
    """
    root = str(REPO_ROOT / BACKEND_ROOT)
    for name in [name for name in sys.modules if name == "app" or name.startswith("app.")]:
        del sys.modules[name]
    sys.path.insert(0, root)
    try:
        return Backend(*(importlib.import_module(f"app.core.{name}") for name in ("domain", "constraints", "config")))
    # Whatever stopped the import is the refusal's reason; a finding would blame a reason nobody read.
    except Exception as error:
        return f"{type(error).__name__}: {error}"
    finally:
        sys.path.remove(root)


@cache
def resolvable_codes() -> frozenset[str]:
    """A rule code a reason may argue from: one a module's code spells, or a read-rules row declares.

    The declaration is left out: it spells every code it declares, and a reason's own text among them.
    """
    codes: set[str] = set()
    for path in tracked_glob(APP_GLOB):
        if path.relative_to(REPO_ROOT).as_posix() != DOMAIN_MODULE:
            codes.update(RAISED_CODE_RE.findall(code_body(path)))
    if (sheet := tracked_page(READ_RULES_SHEET)) is not None and (text := _readable(sheet)) is not None:
        codes.update(READ_ROW_RE.findall(text))
    return frozenset(codes)


@cache
def published_routes() -> dict[str, dict[str, object]]:
    """`openapi.json` rather than the application: the published document is what a route claim is about."""
    page = tracked_page(OPENAPI_PAGE)
    text = None if page is None else _read_text(page)[0]
    return {} if text is None else json.loads(text).get("paths", {})


@cache
def served_pages() -> frozenset[str]:
    """Every URL a `page.tsx` serves, route groups left out as Next.js leaves them."""
    served: set[str] = set()
    for page in tracked_glob(PAGE_GLOB):
        folders = page.relative_to(REPO_ROOT).as_posix().removeprefix(APP_DIR).split("/")[:-1]
        served.add("/" + "/".join(folder for folder in folders if not ROUTE_GROUP_RE.match(folder)))
    return frozenset(served)


@cache
def spelled_names() -> frozenset[str]:
    """Weak on purpose, because the rot it answers is a rename: a name neither tree spells is gone."""
    words: set[str] = set()
    for glob in NAME_GLOBS:
        for path in tracked_glob(glob):
            if path.relative_to(REPO_ROOT).as_posix() != DOMAIN_MODULE and (text := _read_text(path)[0]) is not None:
                words.update(WORD_RE.findall(text))
    return frozenset(words)


def _index_keys(loaded: Backend) -> frozenset[tuple[str, ...]]:
    """Key fields alone: a reason names the group an index covers, never the order it walks it in."""
    constraints = loaded.constraints
    return frozenset(
        {tuple(index.keys) for index in constraints.UNIQUE_INDEXES}
        | {tuple(field for field, _ in support.keys) for support in constraints.SUPPORT_INDEXES}
        | {(ttl.key,) for ttl in constraints.TTL_INDEXES}
    )


def _published(loaded: Backend, token: str) -> bool:
    """The whole path, never its end: `/saisons/{saison_id}` also ends the team and player routes."""
    endpoint = ENDPOINT_RE.match(token)
    route = f"/api/v{loaded.config.API_VERSION}{endpoint.group(2)}" if endpoint else ""
    return endpoint is not None and endpoint.group(1).lower() in published_routes().get(route, {})


def _unresolved(loaded: Backend, token: str, subject: str, invariants: dict[str, list[str]], cite: Cite) -> list[tuple[str, str]]:
    """What one token fails, as a check's name beside its detail, by the first shape it takes."""
    said = f"'{subject}' argues from `{token}`"
    if RULE_CODE_RE.match(token):
        known = token in resolvable_codes()
        return [] if known else [("citation", f"{said}, which no module's code spells outside the declaration and no read-rules row declares")]
    if family := CODE_FAMILY_RE.match(token):
        known = any(code.startswith(family.group(1)) for code in resolvable_codes())
        return [] if known else [("citation", f"{said}, a family no code in a module's code or read-rules row belongs to")]
    if citation := CITATION_RE.match(token):
        if repo_path(citation.group(1)) == DOMAIN_MODULE:
            return [("citation", f"{said}, which cites the declaration itself, answering for nothing")]
        return [(finding.check, f"'{subject}': {finding.detail}") for finding in cite(token, DOMAIN_MODULE, invariants)]
    if REPO_PATH_RE.match(token):
        return [] if repo_path(token) is not None or is_gitignored(token) else [("path", f"{said}, a path the repository holds nowhere")]
    # Ahead of a name: an `I<n>` is also a word either tree spells.
    if INVARIANT_RE.match(token):
        return [] if token in invariants else [("invariant-id", f"{said}, which no spec sheet's invariant table defines")]
    if ENDPOINT_RE.match(token):
        return [] if _published(loaded, token) else [("citation", f"{said}, a route `{OPENAPI_PAGE}` does not publish")]
    if SURFACE_RE.match(token):
        return [] if token in served_pages() else [("path", f"{said}, a page no `page.tsx` under `{APP_DIR}` serves")]
    if key := INDEX_KEY_RE.match(token):
        known = tuple(key.group(1).split(", ")) in _index_keys(loaded)
        return [] if known else [("citation", f"{said}, an index key no index in `app/core/constraints.py` declares")]
    if NAME_RE.match(token):
        known = all(segment in spelled_names() for segment in token.split("."))
        return [] if known else [("citation", f"{said}, a name neither source tree spells outside the declaration")]
    if any(spared.match(token) for spared in SPARED_RES):
        return []
    return [("citation", f"{said}, a shape nothing here reads, so it resolves to nothing")]


def _line(text: str, subject: str) -> int | None:
    """The line opening an entry, found by its subject: the imported value carries none."""
    at = text.find(json.dumps(subject, ensure_ascii=False))
    return None if at < 0 else text.count("\n", 0, at) + 1


def check_unenforced_reasons(invariants: dict[str, list[str]], cite: Cite) -> list[Finding]:
    """Every address the declaration argues from: each reason's tokens, each entry's surface, each rule's routes."""
    loaded = backend()
    if isinstance(loaded, str):
        return []  # `checks.py :: main` refuses the run on it before any check reads the backend
    entries, rules = getattr(loaded.domain, "UNENFORCED", ()), getattr(loaded.domain, "RULES", ())
    if not entries:
        return [Finding("fail", "citation", DOMAIN_MODULE, "declares no `UNENFORCED` entry, so no reason's addresses were read")]
    if not resolvable_codes():
        detail = (
            f"no module under `{APP_GLOB}` spells a code in its code and no read-rules row declares one, so codes were read against nothing"
        )
        return [Finding("fail", "citation", DOMAIN_MODULE, detail)]
    page = tracked_page(DOMAIN_MODULE)
    text = (None if page is None else _read_text(page)[0]) or ""
    found: list[Finding] = []
    for entry in entries:
        line = _line(text, entry.subject)
        for token in REASON_TOKEN_RE.findall(entry.reason):
            unresolved = _unresolved(loaded, token, entry.subject, invariants, cite)
            found.extend(Finding("fail", check, DOMAIN_MODULE, detail, line) for check, detail in unresolved)
        surface = entry.surfaced_by
        served = surface in served_pages() if surface.startswith("/") else repo_path(surface) is not None
        if surface and not served:
            found.append(Finding("fail", "path", DOMAIN_MODULE, f"'{entry.subject}' is surfaced by `{surface}`, which serves nothing", line))
    for rule in rules:
        for token in rule.operation.split(loaded.domain.OPERATION_SEPARATOR):
            if not _published(loaded, token):
                detail = f"`{rule.code}` declares `{token}`, which `{OPENAPI_PAGE}` does not publish"
                found.append(Finding("fail", "citation", DOMAIN_MODULE, detail, _line(text, rule.code)))
    return found
