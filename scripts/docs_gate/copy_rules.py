"""SCRIPTS · the copy rules, over the German a reader actually sees.

`docs/frontend/spec.md` §1.12 held these rules with nothing enforcing them and three spaced em
dashes shipped past a green gate. The corpus is every string literal and JSX element of
`fl_frontend/src`, comments and tests excluded, so what narrows a sweep is the rule and not the
corpus. Scanned rather than parsed: the documentation scope degrades around node, never needs it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final, Literal

from .kernel import REPO_ROOT, Finding, tracked_glob

# Where a reader's German lives. The backend holds none: its refusals are mapped to German on this
# side, so widening the root would add files and no strings.
COPY_ROOT: Final = "fl_frontend/src"
COPY_GLOB: Final = f"{COPY_ROOT}/**/*.ts*"
TEST_SUFFIXES: Final[tuple[str, ...]] = (".test.ts", ".test.tsx")

# One interpolated value, standing where its rendering will. A private-use codepoint, so nothing in
# a source file can spell it and be read as one.
HOLE: Final = "\ue000"

# §1.12's date-range exception recognises a date by the name of the function formatting it, which
# couples this tuple to that name. `copy-corpus` fails when an entry matches nothing, so a rename
# is caught rather than quietly widening the exception.
DATE_FORMATTERS: Final[tuple[str, ...]] = ("formatSpielDatum",)
LITERAL_DATE_RE: Final = re.compile(r"\d{2}\.\d{2}\.\d{4}")

DASH_RE: Final = re.compile(r"[—–-]")
LONG_DASHES: Final = "—–"
# `Ticket- und Cateringverkäufe`: the hyphen holds a compound open until the conjunction completes
# it, so it joins words across the space rather than parting a clause (§1.12).
SUSPENDED_RE: Final = re.compile(r"(?<=\w)-\s+(?:und|oder|bzw\.|sowie|bis|beziehungsweise)\b")

# Capitalised and mid-sentence, the only position carrying the formal address: German capitalises
# a sentence's first word whatever it is, so `Sie` and `Ihre` opening one are evidence of nothing.
FORMAL_RE: Final = re.compile(r"\b(?:Sie|Ihr(?:e|em|en|er|es)?)\b")
SENTENCE_OPENER_RE: Final = re.compile(rf"(?:\A|[.!?:;•·|]|[„“\"'(»–—]|{HOLE})[\s\"'„»(]*\Z")

# One German word per concept (§1.12): a club is a `Team` whatever grammar the sentence prefers.
BANNED_TERMS: Final[dict[str, str]] = {"Mannschaft": "Team"}
BANNED_TERM_RE: Final = re.compile(rf"\b(?:{'|'.join(BANNED_TERMS)})(?:en|s)?\b")

# What separates a reader's sentence from a developer's log line or a list of classes: umlauts,
# plus German function words that no Tailwind class, import specifier or field name spells.
GERMAN_RE: Final = re.compile(
    # Case-insensitive, German capitalising a sentence's first word whatever it is. The `Du` family
    # stays case-sensitive: `dir` is a directory in half the identifiers in the tree.
    r"[äöüÄÖÜß]|\bD(?:u|ein|eine|einen|einem|einer|ir|ich)\b|(?i:"
    r"\b(?:der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines|und|oder|nicht"
    r"|kein|keine|keinen|ist|sind|wird|werden|wurde|hat|haben|kann|muss|sich|noch|schon|auch"
    r"|aber|wenn|dann|damit|dass|mit|ohne|von|vom|zum|zur|aus|bei|nach|unter|durch|gegen|hier"
    r"|bitte|diese|dieser|dieses|alle|allen|jede|jeder|jedes|sowie|mehr|steht|gibt|keiner)\b)"
)

# Named rather than spelled inline, for `kernel.py :: UNTOKENIZABLE`'s reason: the formatter folds
# a tuple into PEP 758's `except A, B:`, newer than `checker_kernel.py :: PARSE_FLOOR`.
UNREADABLE: Final = (OSError, UnicodeDecodeError)

Kind = Literal["string", "jsx"]


@dataclass(frozen=True, slots=True)
class Copy:
    """A string literal, or a JSX element flattened to what it puts on screen.

    `text` holds a `HOLE` per interpolated value and `holes` their sources, so a dash is judged
    against what will stand beside it.
    """

    kind: Kind
    text: str
    holes: tuple[str, ...]

    def excerpt(self, at: int, width: int = 64) -> str:
        """The finding's anchor: the offending run, quoted as a reader meets it."""
        start = max(0, at - width // 2)
        shown = " ".join(self.text[start : start + width].replace(HOLE, "…").split())
        return f"{'…' if start else ''}{shown}{'…' if start + width < len(self.text) else ''}"


@dataclass(slots=True)
class _Buffer:
    """A rendered span under construction, and the sources of the values interpolated into it."""

    parts: list[str] = field(default_factory=list)
    holes: list[str] = field(default_factory=list)

    def add(self, piece: str) -> None:
        if piece:
            self.parts.append(piece)

    def add_hole(self, source: str) -> None:
        self.parts.append(HOLE)
        self.holes.append(source)


@dataclass(slots=True)
class _Frame:
    """One nesting level: code, a template literal, or the children of a JSX element."""

    kind: Literal["code", "tmpl", "jsx"]
    depth: int = 0
    tag: bool = False
    # `<AdminCrudView<AdminTeamRow> …>`: the type argument's `>` would otherwise close the tag.
    generics: int = 0
    buffer: _Buffer | None = None
    owns: bool = False
    hole_at: int = -1


# Where the scan may stop. `/` is here for the comment openers and for a regex literal, whose
# quotes would otherwise open a string that never closes.
CODE_STOP_RE: Final = re.compile(r"[\"'`<>{}/]")
JSX_STOP_RE: Final = re.compile(r"[<{}]")
TEMPLATE_STOP_RE: Final = re.compile(r"[`\\]|\$\{")
# What may stand before a JSX element, read off the last code characters ahead of the `<`.
JSX_LEAD_RE: Final = re.compile(r"(?:[(,={};:?&|>\[!]|\breturn|\bcase)\Z")
# What may stand before a regex literal: the same set without `>`, which closes a JSX tag.
REGEX_LEAD_RE: Final = re.compile(r"[(,={};:?&|\[!]\Z")
LEAD_WINDOW: Final = 8


@dataclass(slots=True)
class _Lead:
    """The last code characters before the cursor, whitespace and comments dropped.

    Carried, never read back out of the file: JSX indents past any window, and a comment before an
    element hides what precedes it. Both would read as a bare `<`.
    """

    text: str = ""

    def push(self, piece: str) -> None:
        kept = piece.rstrip()
        if kept:
            self.text = kept[-LEAD_WINDOW:]


def _jsx_text(raw: str) -> str:
    """One JSX text node as React renders it: each line's edges trimmed, blank lines dropped.

    A newline between two elements therefore leaves nothing, which is what glues a lone hyphen to
    the values on either side of it.
    """
    lines = raw.split("\n")
    kept: list[str] = []
    for index, line in enumerate(lines):
        piece = line if index == 0 else line.lstrip()
        if index != len(lines) - 1:
            piece = piece.rstrip()
        if piece:
            kept.append(piece)
    return " ".join(kept)


def _string_end(text: str, start: int) -> int:
    """A quoted literal's closing quote, or the newline that leaves it unclosed."""
    quote = text[start]
    index = start + 1
    while index < len(text):
        char = text[index]
        if char == "\\":
            index += 2
            continue
        if char in (quote, "\n"):
            return index
        index += 1
    return len(text)


def _skip_regex(text: str, start: int) -> int:
    """Past a regex literal, or past the slash alone where the line closes none."""
    index = start + 1
    while index < len(text) and text[index] != "\n":
        char = text[index]
        if char == "\\":
            index += 2
            continue
        if char == "[":
            while index < len(text) and text[index] not in "]\n":
                index += 2 if text[index] == "\\" else 1
        if index < len(text) and text[index] == "/":
            return index + 1
        index += 1
    return start + 1


def _close_hole(frames: list[_Frame], text: str, index: int) -> None:
    """Record what one `${…}` or `{…}` will render, now that its end is known."""
    frame = frames.pop()
    if frame.buffer is not None and frame.hole_at >= 0:
        frame.buffer.add_hole(text[frame.hole_at : index - 1])


def _scan(text: str, *, jsx: bool) -> tuple[list[Copy], bool]:
    """Every rendered span in one file, and whether the scan closed every frame it opened.

    An unbalanced scan proves nothing about the file that produced it, so the caller reports the
    file rather than trusting the spans.
    """
    found: list[Copy] = []
    frames = [_Frame("code")]
    lead = _Lead()
    index, size = 0, len(text)

    while index < size:
        frame = frames[-1]

        if frame.kind == "jsx":
            stop = JSX_STOP_RE.search(text, index)
            end = stop.start() if stop else size
            if frame.buffer is not None:
                frame.buffer.add(_jsx_text(text[index:end]))
            if stop is None:
                break
            index = end
            if text[index] == "}":
                return found, False  # a brace closing nothing: this file was not read correctly
            if text[index] == "{":
                frames.append(_Frame("code", buffer=frame.buffer, hole_at=index + 1))
                lead.push("{")
                index += 1
                continue
            if text.startswith("</", index):
                close = text.find(">", index)
                if frame.owns and frame.buffer is not None and frame.buffer.parts:
                    found.append(Copy("jsx", "".join(frame.buffer.parts), tuple(frame.buffer.holes)))
                frames.pop()
                lead.push(">")
                index = size if close == -1 else close + 1
                continue
            frames.append(_Frame("code", tag=True, buffer=frame.buffer))
            lead.push("<")
            index += 1
            continue

        if frame.kind == "tmpl":
            stop = TEMPLATE_STOP_RE.search(text, index)
            end = stop.start() if stop else size
            if frame.buffer is not None:
                frame.buffer.add(text[index:end])
            if stop is None:
                break
            token = stop.group(0)
            if token == "\\":
                index = end + 2
                continue
            if token == "`":
                if frame.owns and frame.buffer is not None and frame.buffer.parts:
                    found.append(Copy("string", "".join(frame.buffer.parts), tuple(frame.buffer.holes)))
                frames.pop()
                index = end + 1
                continue
            frames.append(_Frame("code", buffer=frame.buffer, hole_at=end + 2))
            lead.push("{")
            index = end + 2
            continue

        stop = CODE_STOP_RE.search(text, index)
        if stop is None:
            break
        lead.push(text[index : stop.start()])
        index = stop.start()
        char = text[index]

        if char == "/":
            following = text[index + 1 : index + 2]
            if following == "/":
                newline = text.find("\n", index)
                index = size if newline == -1 else newline
            elif following == "*":
                close = text.find("*/", index)
                index = size if close == -1 else close + 2
            else:
                # Inside a tag the slash closes the element; anywhere else it opens a regex literal
                # whose quotes would otherwise start a string, or it divides.
                regex = not (frame.tag and frame.depth == 0) and REGEX_LEAD_RE.search(lead.text)
                index = _skip_regex(text, index) if regex else index + 1
                lead.push("/")
            continue

        if char in "\"'":
            close = _string_end(text, index)
            found.append(Copy("string", text[index + 1 : close], ()))
            lead.push(char)
            index = close + 1
            continue

        if char == "`":
            frames.append(_Frame("tmpl", buffer=_Buffer(), owns=True))
            lead.push("`")
            index += 1
            continue

        if char == "{":
            frame.depth += 1
            lead.push("{")
            index += 1
            continue

        if char == "}":
            frame.depth -= 1
            lead.push("}")
            index += 1
            if frame.depth < 0:
                if len(frames) == 1:
                    return found, False
                _close_hole(frames, text, index)
            continue

        if char == "<":
            following = text[index + 1 : index + 2]
            if jsx and following and (following.isalpha() or following in "_>") and JSX_LEAD_RE.search(lead.text):
                buffer = frame.buffer
                frames.append(_Frame("code", tag=True, buffer=buffer or _Buffer(), owns=buffer is None))
            elif frame.tag and frame.depth == 0:
                frame.generics += 1
            lead.push("<")
            index += 1
            continue

        # `>` closes a JSX tag, and is arithmetic everywhere else.
        if frame.tag and frame.depth == 0 and frame.generics:
            frame.generics -= 1
        elif frame.tag and frame.depth == 0:
            selfclosing = lead.text.endswith("/")
            frames.pop()
            if selfclosing:
                if frame.owns and frame.buffer is not None and frame.buffer.parts:
                    found.append(Copy("jsx", "".join(frame.buffer.parts), tuple(frame.buffer.holes)))
            else:
                frames.append(_Frame("jsx", buffer=frame.buffer, owns=frame.owns))
        lead.push(">")
        index += 1

    return found, len(frames) == 1 and frames[0].kind == "code"


def copy_spans(path: Path) -> tuple[list[Copy], bool]:
    """One file's rendered spans, and whether the scan balanced."""
    try:
        text = path.read_text(encoding="utf-8")
    except UNREADABLE:
        return [], False
    return _scan(text, jsx=path.suffix == ".tsx")


def is_german(span: Copy) -> bool:
    """Whether a span addresses a reader in German rather than a developer in code."""
    return GERMAN_RE.search(span.text) is not None


def corpus_files() -> tuple[Path, ...]:
    """Every tracked copy-bearing file, tests excluded: a fixture is never rendered."""
    return tuple(path for path in tracked_glob(COPY_GLOB) if not path.name.endswith(TEST_SUFFIXES))


def _renders_date(source: str) -> bool:
    """Whether an interpolated value renders a calendar date, which an en dash may join."""
    return LITERAL_DATE_RE.search(source) is not None or any(f"{name}(" in source for name in DATE_FORMATTERS)


def _neighbour(span: Copy, at: int, *, ahead: bool) -> str:
    """The character a dash renders against, or `""` at the span's edge.

    A span built from separate elements is judged on what it shows, not on the markup between the
    parts (§1.12), so this crosses the whitespace JSX discards.
    """
    text = span.text
    index = at + 1 if ahead else at - 1
    while 0 <= index < len(text) and text[index].isspace():
        index += 1 if ahead else -1
    return text[index] if 0 <= index < len(text) else ""


def _flank(span: Copy, at: int, *, ahead: bool) -> str | None:
    """The source of the value rendering beside a dash, or None where a character renders there."""
    text = span.text
    index = at + 1 if ahead else at - 1
    while 0 <= index < len(text) and text[index].isspace():
        index += 1 if ahead else -1
    if not (0 <= index < len(text)) or text[index] != HOLE:
        return None
    ordinal = text.count(HOLE, 0, index)
    return span.holes[ordinal] if ordinal < len(span.holes) else None


def _is_date_range(span: Copy, at: int) -> bool:
    """§1.12's one permitted punctuation dash: an en dash with a date on each side."""
    if span.text[at] != "–":
        return False
    behind, ahead = _flank(span, at, ahead=False), _flank(span, at, ahead=True)
    if behind is not None and ahead is not None:
        return _renders_date(behind) and _renders_date(ahead)
    return LITERAL_DATE_RE.search(span.text[:at]) is not None and LITERAL_DATE_RE.search(span.text[at + 1 :]) is not None


def _is_punctuation(span: Copy, at: int) -> bool:
    """Whether the dash at `at` parts a clause rather than joining a term.

    A long dash parts one wherever it stands loose. A hyphen connects, so it must be loose on BOTH
    sides (`-mx-1` is not), have a word and not two values beside it, and stand in German.
    """
    behind, ahead = span.text[at - 1 : at], span.text[at + 1 : at + 2]
    if span.text[at] in LONG_DASHES:
        return behind.isspace() or ahead.isspace() or (behind == HOLE and ahead == HOLE)
    if not behind or not ahead or not all(char.isspace() or char == HOLE for char in (behind, ahead)):
        return False
    return (_neighbour(span, at, ahead=True) != HOLE or _neighbour(span, at, ahead=False) != HOLE) and is_german(span)


def _dash_findings(rel: str, span: Copy) -> list[Finding]:
    """Every dash in one span that §1.12 forbids."""
    found: list[Finding] = []
    for match in DASH_RE.finditer(span.text):
        at = match.start()
        if not _is_punctuation(span, at) or _is_date_range(span, at) or SUSPENDED_RE.match(span.text, at):
            continue
        behind, ahead = _flank(span, at, ahead=False), _flank(span, at, ahead=True)
        # A span carrying nothing but the dash needs its neighbours named, `…—…` anchoring nothing.
        where = f"between `{behind}` and `{ahead}`" if behind is not None and ahead is not None else f"in `{span.excerpt(at)}`"
        found.append(Finding("fail", "copy-dash", rel, f"a dash is punctuation {where} (§1.12)"))
    return found


def _formal_findings(rel: str, span: Copy) -> list[Finding]:
    """`Sie` or `Ihr` standing where only the formal address puts it.

    The opener test is what makes this fail rather than report: all twelve in the tree open a
    sentence, third person each. Its cost is a formal `Sie` doing the same.
    """
    if not is_german(span):
        return []
    found: list[Finding] = []
    for match in FORMAL_RE.finditer(span.text):
        if SENTENCE_OPENER_RE.search(span.text[: match.start()]):
            continue
        detail = f"`{match.group(0)}` is the formal address in `{span.excerpt(match.start())}` -- the reader is `Du` (§1.12)"
        found.append(Finding("fail", "copy-formal", rel, detail))
    return found


def _term_findings(rel: str, span: Copy) -> list[Finding]:
    """A concept spelled with a word §1.12 retired."""
    found: list[Finding] = []
    for match in BANNED_TERM_RE.finditer(span.text):
        wanted = next(preferred for banned, preferred in BANNED_TERMS.items() if match.group(0).startswith(banned))
        found.append(Finding("fail", "copy-term", rel, f"`{match.group(0)}` in `{span.excerpt(match.start())}` -- say `{wanted}` (§1.12)"))
    return found


def check_copy_rules() -> list[Finding]:
    """§1.12's mechanically checkable half, over every rendered German string in the frontend."""
    if not (REPO_ROOT / COPY_ROOT).is_dir():
        detail = "absent, so nothing rendered was read and the copy rules held over nothing"
        return [Finding("fail", "copy-corpus", COPY_ROOT, detail)]

    files = corpus_files()
    found: list[Finding] = []
    spans = 0
    german = 0
    formatters = set(DATE_FORMATTERS)

    for path in files:
        rel = path.relative_to(REPO_ROOT).as_posix()
        collected, balanced = copy_spans(path)
        if not balanced:
            found.append(Finding("fail", "copy-corpus", rel, "could not be read as TypeScript, so its rendered strings went unchecked"))
            continue
        spans += len(collected)
        for span in collected:
            formatters -= {name for name in formatters if any(f"{name}(" in hole for hole in span.holes)}
            if is_german(span):
                german += 1
            found.extend(_dash_findings(rel, span))
            found.extend(_formal_findings(rel, span))
            found.extend(_term_findings(rel, span))

    # Three ways this sweep goes quiet without anything else noticing: the tree moves, the scanner
    # stops extracting, and an exempting name outlives what it exempted.
    if not files:
        found.append(Finding("fail", "copy-corpus", COPY_ROOT, "holds no copy-bearing file, so the sweep read nothing"))
    elif not german:
        quiet = f"{spans} span(s) read and no German among them -- the scanner stopped finding copy"
        found.append(Finding("fail", "copy-corpus", COPY_ROOT, quiet))
    for name in sorted(formatters):
        found.append(Finding("fail", "copy-corpus", COPY_ROOT, f"`{name}` exempts a date range and is called nowhere -- drop it or repoint it"))
    return found
