"""SCRIPTS · no name in the tree's code or paths holds a retired German stem.

The code's names are English but for the league's own words, which `docs/glossary.md` lists and
which no line of the list holds; the visitor reads German. `retired-stems.txt` beside this file holds
every German word the programme renamed, one a line, and this check refuses any of them surviving in
a tracked file's path or in a name inside a tracked code file.

A name is split into its words the way a reader splits it -- at a case change, an underscore, a
hyphen, a dot, a slash or a digit -- and a word holds a stem only when it IS the stem: `termin`
retires `terminRow` and never `terminal`. Umlauts are spelled out first, as the list spells them.

What is read, by where the German stands rather than by a list of files:
- Every tracked path, segment by segment.
- Every tracked code file's identifiers, and its string literals that are names: a literal with no
  whitespace, no `@` and no letter outside ASCII, which is neither one capitalised word nor a club's
  two or three capitals. A sentence, a mail address, a word with an umlaut, a capitalised word and a
  `Kürzel` are a visitor's text, wherever they stand; an interpolated literal is judged whole.
- Comments, docstrings and regular-expression literals are prose or patterns, JSX text is what the
  page shows, and a string in a text catalogue is the visitor's German: none of them is a name.
- A file git marks `linguist-generated` follows the code that generates it, and a lockfile the
  package manager's index: neither is read, the code behind each is.

The list holds no word English spells the same and this tree uses in its English sense -- the shell's
`die`, TypeScript's `ES2022`, an English `stand` -- since no word check tells the two apart.

Invariants:
- Each hit is reported once per file, line, name and stem.
- A file this reader cannot lex refuses rather than passing, and so does a run that judged nothing.
"""

from __future__ import annotations

import bisect
import io
import re
import subprocess
import sys
import tokenize
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Final

# Every caller runs this as a script, so sys.path opens with THIS directory and `lib/` is a
# sibling of it rather than in it.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from checker_kernel import (
    EXIT_REFUSED,
    REPO_ROOT,
    UNREADABLE,
    Finding,
    report_findings,
    run,
)

# Inside the tree it judges, so CI reads the list the checkout carries.
STEM_LIST: Final = "scripts/checks/retired-stems.txt"

# The package managers write these, never a person, and they name packages rather than the code's own things.
LOCKFILES: Final = frozenset({"pnpm-lock.yaml", "uv.lock"})

# The text catalogues, the one place the frontend's German stands, the two the lint's `CATALOGUE_FILES`
# names: a string in either is a visitor's text however it is spelled, a key a name like any other. A
# catalogue missing here shows as hits on its words, never as a pass.
CATALOGUES: Final = frozenset({"fl_frontend/src/core/copy.ts", "fl_frontend/src/core/serverCopy.ts"})

PYTHON: Final = frozenset({".py"})
SCRIPT: Final = frozenset({".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"})
JSX: Final = frozenset({".tsx", ".jsx"})
SHELL: Final = frozenset({".sh"})
# A suffixless file is a shell script by its first line, as a git hook or a Claude hook is.
SHELL_SHEBANG: Final = re.compile(r"#![^\n]*\b(?:ba)?sh\b")


@dataclass(frozen=True)
class Syntax:
    """How a data or configuration language spells a comment, and whether a quoted string may span lines."""

    line_comment: str | None
    block_comment: bool
    multiline_strings: bool


HASH: Final = Syntax("#", block_comment=False, multiline_strings=False)
DATA: Final = {
    ".json": Syntax(None, block_comment=False, multiline_strings=False),
    ".jsonc": Syntax("//", block_comment=True, multiline_strings=False),
    ".yml": HASH,
    ".yaml": HASH,
    ".toml": HASH,
    ".css": Syntax(None, block_comment=True, multiline_strings=False),
    # nginx: a `return` body may be one quoted page spanning many lines.
    ".conf": Syntax("#", block_comment=False, multiline_strings=True),
}
# Code a suffix does not announce: these names, and a suffixless script by its shebang.
NAMED: Final = {"Dockerfile": HASH, ".gitignore": HASH, ".dockerignore": HASH, ".prettierignore": HASH, ".editorconfig": HASH}

WORD: Final = re.compile(r"[A-Z]+(?![a-z])|[A-Z]?[a-z]+")
UMLAUTS: Final = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue"})
# A string literal that is a name: an identifier, a dotted or slashed path, a key or a route, with at least one letter.
NAME_SHAPED: Final = re.compile(r"[A-Za-z0-9_$.:/\-\[\]{}*]*[A-Za-z][A-Za-z0-9_$.:/\-\[\]{}*]*")
# A word as a sentence or a made-up person spells it, or a club's two or three letters (the glossary's `Kürzel`).
VISITOR_WORD: Final = re.compile(r"[A-Z][a-z]+|[A-Z]{2,3}")
# Where a template, an f-string or a double-quoted shell word interpolates: the literal is judged whole, so an
# address built around an expression is still an address, its words still the stretches between.
PLACEHOLDER: Final = "{}"


class Unplaceable(Exception):
    """A construct the lexer cannot place, so the file was not judged."""


class Unreadable(Exception):
    """A tracked code file that does not read as utf-8, so it was not judged."""


class NothingJudged(Exception):
    """A run that read no code file, which would read as a pass."""


@dataclass(frozen=True)
class Piece:
    """One name, or one string literal that may be one, at the line it starts on."""

    line: int
    text: str
    literal: bool


@dataclass(frozen=True)
class Hit:
    path: str
    line: int | None
    name: str
    stem: str


def words(name: str) -> list[str]:
    return [word.lower() for word in WORD.findall(name.translate(UMLAUTS))]


def is_name(piece: Piece) -> bool:
    if not piece.literal:
        return True
    return NAME_SHAPED.fullmatch(piece.text) is not None and VISITOR_WORD.fullmatch(piece.text) is None


class _Lines:
    """The line an offset stands on, counted from one."""

    def __init__(self, text: str) -> None:
        self.starts = [0] + [index + 1 for index, char in enumerate(text) if char == "\n"]

    def of(self, offset: int) -> int:
        return bisect.bisect_right(self.starts, offset)


# --- python -----------------------------------------------------------------------------------------

STRING_PREFIX: Final = re.compile(r"[A-Za-z]*('''|\"\"\"|'|\")")
STRING_STARTS: Final = frozenset({tokenize.FSTRING_START, tokenize.TSTRING_START})
STRING_MIDDLES: Final = frozenset({tokenize.FSTRING_MIDDLE, tokenize.TSTRING_MIDDLE})
STRING_ENDS: Final = frozenset({tokenize.FSTRING_END, tokenize.TSTRING_END})


def python_pieces(text: str) -> Iterator[Piece]:
    # One entry per f-string or t-string still open, nested ones inside a replacement field included: its line and its stretches.
    opened_strings: list[tuple[int, list[str]]] = []
    try:
        for token in tokenize.generate_tokens(io.StringIO(text).readline):
            if token.type == tokenize.NAME:
                yield Piece(token.start[0], token.string, literal=False)
            elif token.type == tokenize.STRING:
                opened = STRING_PREFIX.match(token.string)
                if opened is None:
                    raise Unplaceable(f"line {token.start[0]}: a string token with no quote")
                yield Piece(token.start[0], token.string[opened.end() : -len(opened.group(1))], literal=True)
            elif token.type in STRING_STARTS:
                opened_strings.append((token.start[0], []))
            elif token.type in STRING_MIDDLES and opened_strings:
                opened_strings[-1][1].append(token.string)
            elif token.type in STRING_ENDS and opened_strings:
                line, stretches = opened_strings.pop()
                yield Piece(line, PLACEHOLDER.join(stretches), literal=True)
    except (tokenize.TokenError, SyntaxError) as error:
        raise Unplaceable(str(error)) from error


# --- typescript and javascript -----------------------------------------------------------------------

IDENTIFIER: Final = re.compile(r"#?[A-Za-z_$\u00c0-\uffff][\w$]*")
NUMBER: Final = re.compile(r"\.?[0-9][\w.]*")
# After these a `/` opens a regular expression and a `<` may open JSX; after a name, a value or a `)` they divide and compare.
EXPRESSION_KEYWORDS: Final = frozenset(
    {"return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await", "extends"}
)
EXPRESSION_PUNCTUATION: Final = frozenset("(,=:[!&|?{};+-*%<>~^")
TAG: Final = re.compile(r"[A-Za-z_$][\w$.:-]*")
# A tag and what follows it, where `<T,>` and `<T extends U>` are a generic arrow function's type parameters instead.
OPENING: Final = re.compile(r"<([A-Za-z_$][\w$.:-]*)\s*(\S*)")
ATTRIBUTE: Final = re.compile(r"[A-Za-z_$][\w$:-]*")


class _Script:
    """A lexer for the one question asked of a script: which spans are names and which are literals."""

    def __init__(self, text: str, *, jsx: bool) -> None:
        self.text, self.jsx, self.at, self.lines = text, jsx, 0, _Lines(text)
        self.pieces: list[Piece] = []
        self.previous: str | None = None

    def fail(self, what: str) -> Unplaceable:
        return Unplaceable(f"line {self.lines.of(self.at)}: {what}")

    def expression_may_start(self) -> bool:
        previous = self.previous
        return previous is None or previous in EXPRESSION_PUNCTUATION or previous in EXPRESSION_KEYWORDS

    def emit(self, offset: int, text: str, *, literal: bool) -> None:
        self.pieces.append(Piece(self.lines.of(offset), text, literal=literal))

    def comment(self) -> bool:
        """Pass over a comment at the cursor, saying whether there was one; code and an element's attributes both hold them."""
        text = self.text
        if text.startswith("//", self.at):
            end = text.find("\n", self.at)
            self.at = len(text) if end < 0 else end
            return True
        if text.startswith("/*", self.at):
            end = text.find("*/", self.at + 2)
            if end < 0:
                raise self.fail("a block comment that never closes")
            self.at = end + 2
            return True
        return False

    def code(self, *, until_brace: bool) -> None:
        text, depth = self.text, 0
        while self.at < len(text):
            char = text[self.at]
            if char.isspace():
                self.at += 1
            elif self.comment():
                pass
            elif char in "'\"":
                self.quoted(char)
                self.previous = "value"
            elif char == "`":
                self.template()
                self.previous = "value"
            elif char == "/" and self.expression_may_start():
                self.regex()
                self.previous = "value"
            elif char == "<" and self.jsx and self.expression_may_start() and self.opens_element():
                self.element()
                self.previous = "value"
            elif char == "{":
                depth += 1
                self.at += 1
                self.previous = "{"
            elif char == "}":
                self.at += 1
                if depth == 0 and until_brace:
                    return
                depth -= 1
                self.previous = "}"
            elif (number := NUMBER.match(text, self.at)) is not None:
                self.at = number.end()
                self.previous = "value"
            elif (name := IDENTIFIER.match(text, self.at)) is not None:
                self.emit(self.at, name.group().lstrip("#"), literal=False)
                self.at = name.end()
                self.previous = name.group() if name.group() in EXPRESSION_KEYWORDS else "value"
            else:
                self.at += 1
                self.previous = "value" if char in ")]" else char
        if until_brace:
            raise self.fail("a `${` or `{` that never closes")

    def quoted(self, quote: str) -> None:
        start, at, text = self.at, self.at + 1, self.text
        while at < len(text) and text[at] != quote:
            if text[at] == "\\":
                at += 1
            elif text[at] == "\n":
                raise self.fail("a string that never closes on its line")
            at += 1
        if at >= len(text):
            raise self.fail("a string that never closes")
        self.emit(start, text[start + 1 : at], literal=True)
        self.at = at + 1

    def template(self) -> None:
        text, start = self.text, self.at
        self.at += 1
        chunk, chunks = self.at, []
        while self.at < len(text):
            char = text[self.at]
            if char == "\\":
                self.at += 2
            elif char == "`":
                chunks.append(text[chunk : self.at])
                self.emit(start, PLACEHOLDER.join(chunks), literal=True)
                self.at += 1
                return
            elif text.startswith("${", self.at):
                chunks.append(text[chunk : self.at])
                self.at += 2
                self.previous = "("
                self.code(until_brace=True)
                chunk = self.at
            else:
                self.at += 1
        raise self.fail("a template literal that never closes")

    def regex(self) -> None:
        text, at, in_class = self.text, self.at + 1, False
        while at < len(text):
            char = text[at]
            if char == "\\":
                at += 2
                continue
            if char == "\n":
                raise self.fail("a regular expression that never closes on its line")
            if char == "[":
                in_class = True
            elif char == "]":
                in_class = False
            elif char == "/" and not in_class:
                break
            at += 1
        else:
            raise self.fail("a regular expression that never closes")
        flags = IDENTIFIER.match(text, at + 1)
        self.at = at + 1 if flags is None else flags.end()

    def opens_element(self) -> bool:
        """A `<` that opens JSX rather than a generic arrow function's type parameters, which `.tsx` spells `<T,>`."""
        text = self.text
        if text.startswith("<>", self.at):
            return True
        name = OPENING.match(text, self.at)
        return name is not None and not name.group(2).startswith((",", "extends"))

    def element(self) -> None:
        text = self.text
        self.at += 1
        if text.startswith(">", self.at):
            self.at += 1
            self.children()
            return
        tag = TAG.match(text, self.at)
        if tag is None:
            raise self.fail("an element with no name")
        self.emit(self.at, tag.group(), literal=False)
        self.at = tag.end()
        if text.startswith("<", self.at):
            self.type_arguments()
        while self.at < len(text):
            char = text[self.at]
            if char.isspace():
                self.at += 1
            elif self.comment():
                pass
            elif text.startswith("/>", self.at):
                self.at += 2
                return
            elif char == ">":
                self.at += 1
                self.children()
                return
            elif char == "{":
                self.at += 1
                self.previous = "("
                self.code(until_brace=True)
            elif (name := ATTRIBUTE.match(text, self.at)) is not None:
                self.emit(self.at, name.group(), literal=False)
                self.at = name.end()
            elif char == "=":
                self.at += 1
            elif char in "'\"":
                self.quoted(char)
            else:
                raise self.fail(f"an element's attributes holding {char!r}")
        raise self.fail("an element that never closes")

    def type_arguments(self) -> None:
        """An element's `<Type>` after its tag, whose names are names like any other."""
        text, depth = self.text, 0
        while self.at < len(text):
            char = text[self.at]
            if char == "<":
                depth += 1
            elif char == ">":
                depth -= 1
                if depth == 0:
                    self.at += 1
                    return
            elif (name := IDENTIFIER.match(text, self.at)) is not None:
                self.emit(self.at, name.group(), literal=False)
                self.at = name.end()
                continue
            self.at += 1
        raise self.fail("an element's type arguments that never close")

    def children(self) -> None:
        """What a page shows between the tags is its text; only an expression in braces is code."""
        text = self.text
        while self.at < len(text):
            char = text[self.at]
            if char == "{":
                self.at += 1
                self.previous = "("
                self.code(until_brace=True)
            elif text.startswith("</", self.at):
                end = text.find(">", self.at)
                if end < 0:
                    raise self.fail("a closing tag that never closes")
                if (tag := TAG.match(text, self.at + 2)) is not None:
                    self.emit(self.at, tag.group(), literal=False)
                self.at = end + 1
                return
            elif char == "<":
                self.previous = "("
                self.element()
            else:
                self.at += 1
        raise self.fail("an element whose children never close")


def script_pieces(text: str, *, jsx: bool) -> list[Piece]:
    lexer = _Script(text, jsx=jsx)
    lexer.code(until_brace=False)
    return lexer.pieces


# --- shell ------------------------------------------------------------------------------------------

SHELL_WORD: Final = re.compile(r"[A-Za-z_][\w-]*")
SHELL_NAME: Final = re.compile(r"\$\{?#?([A-Za-z_]\w*)")
HEREDOC: Final = re.compile(r"<<(-?)\s*(['\"]?)([A-Za-z_]\w*)\2")
CLOSER: Final = {")": "(", "}": "{"}


class _Shell:
    """The same question asked of bash: names, quoted literals, and the comments and heredoc bodies to pass over."""

    def __init__(self, text: str) -> None:
        self.text, self.at, self.lines = text, 0, _Lines(text)
        self.pieces: list[Piece] = []
        self.heredocs: list[tuple[str, bool]] = []

    def fail(self, what: str) -> Unplaceable:
        return Unplaceable(f"line {self.lines.of(self.at)}: {what}")

    def emit(self, offset: int, text: str, *, literal: bool) -> None:
        self.pieces.append(Piece(self.lines.of(offset), text, literal=literal))

    def code(self, *, until: str | None) -> None:
        """Up to the `)` closing a `$(` or the `}` closing a `${`, or to the end where `until` is None."""
        text, depth = self.text, 0
        while self.at < len(text):
            char = text[self.at]
            if char == "\n":
                self.at += 1
                self.skip_heredocs()
            elif char == "#" and (self.at == 0 or text[self.at - 1] in " \t\n;(|&"):
                end = text.find("\n", self.at)
                self.at = len(text) if end < 0 else end
            elif char == "\\":
                self.at += 2
            elif text.startswith("$'", self.at):
                self.at += 1
                self.single(escapes=True)
            elif char == "'":
                self.single(escapes=False)
            elif char == '"':
                self.double()
            elif char == "$":
                self.expansion()
            elif (heredoc := HEREDOC.match(text, self.at)) is not None and not text.startswith("<<<", self.at):
                self.heredocs.append((heredoc.group(3), heredoc.group(1) == "-"))
                self.at = heredoc.end()
            elif until is not None and char == CLOSER[until]:
                depth += 1
                self.at += 1
            elif char == until:
                self.at += 1
                if depth == 0:
                    return
                depth -= 1
            elif (word := SHELL_WORD.match(text, self.at)) is not None:
                self.emit(self.at, word.group(), literal=False)
                self.at = word.end()
            else:
                self.at += 1
        if until is not None:
            raise self.fail(f"an expansion that never reaches its {until}")

    def expansion(self) -> None:
        """A `$` and what it expands: a command, a parameter with its operand, or a bare name."""
        text = self.text
        if text.startswith("$(", self.at):
            self.at += 2
            self.code(until=")")
            return
        name = SHELL_NAME.match(text, self.at)
        if name is None:
            self.at += 1
            return
        self.emit(self.at, name.group(1), literal=False)
        self.at = name.end()
        if name.group().startswith("${"):
            self.code(until="}")

    def skip_heredocs(self) -> None:
        text = self.text
        for delimiter, tabbed in self.heredocs:
            while self.at < len(text):
                end = text.find("\n", self.at)
                line = text[self.at : len(text) if end < 0 else end]
                self.at = len(text) if end < 0 else end + 1
                if (line.lstrip("\t") if tabbed else line) == delimiter:
                    break
            else:
                raise self.fail(f"a heredoc that never reaches {delimiter}")
        self.heredocs.clear()

    def single(self, *, escapes: bool) -> None:
        start, at, text = self.at, self.at + 1, self.text
        while at < len(text) and text[at] != "'":
            at += 2 if escapes and text[at] == "\\" else 1
        if at >= len(text):
            raise self.fail("a quoted string that never closes")
        self.emit(start, text[start + 1 : at], literal=True)
        self.at = at + 1

    def double(self) -> None:
        text, start = self.text, self.at
        self.at += 1
        chunk, chunks = self.at, []
        while self.at < len(text):
            char = text[self.at]
            if char == "\\":
                self.at += 2
            elif char == '"':
                chunks.append(text[chunk : self.at])
                self.emit(start, PLACEHOLDER.join(chunks), literal=True)
                self.at += 1
                return
            elif char == "$":
                chunks.append(text[chunk : self.at])
                self.expansion()
                chunk = self.at
            else:
                self.at += 1
        raise self.fail("a double-quoted string that never closes")


def shell_pieces(text: str) -> list[Piece]:
    lexer = _Shell(text)
    lexer.code(until=None)
    return lexer.pieces


# --- data and configuration ---------------------------------------------------------------------------

BAREWORD: Final = re.compile(r"[A-Za-z_][\w-]*")


def data_pieces(text: str, syntax: Syntax) -> list[Piece]:
    lines, pieces, at = _Lines(text), [], 0
    while at < len(text):
        char = text[at]
        line_comment = syntax.line_comment
        if line_comment is not None and text.startswith(line_comment, at) and (at == 0 or text[at - 1].isspace() or line_comment != "#"):
            end = text.find("\n", at)
            at = len(text) if end < 0 else end
        elif syntax.block_comment and text.startswith("/*", at):
            end = text.find("*/", at + 2)
            if end < 0:
                raise Unplaceable(f"line {lines.of(at)}: a block comment that never closes")
            at = end + 2
        elif char in "'\"" and (at == 0 or text[at - 1].isspace() or text[at - 1] in ":=,[{("):
            end = at + 1
            while end < len(text) and text[end] != char and (syntax.multiline_strings or text[end] != "\n"):
                end += 2 if text[end] == "\\" else 1
            if end >= len(text) or text[end] != char:
                raise Unplaceable(f"line {lines.of(at)}: a quoted string that never closes")
            pieces.append(Piece(lines.of(at), text[at + 1 : end], literal=True))
            at = end + 1
        elif (word := BAREWORD.match(text, at)) is not None and (at == 0 or not text[at - 1].isalnum()):
            pieces.append(Piece(lines.of(at), word.group(), literal=False))
            at = word.end()
        else:
            at += 1
    return pieces


# --- the tree ---------------------------------------------------------------------------------------


def suffix_of(path: str) -> str:
    name = path.rsplit("/", 1)[-1]
    return name[name.rfind(".") :] if "." in name[1:] else ""


def may_be_code(path: str) -> bool:
    """Whether a file's name makes it code, or leaves its shebang to say: an image or a document is never read."""
    suffix = suffix_of(path)
    return not suffix or suffix in PYTHON | SCRIPT | SHELL or suffix in DATA or path.rsplit("/", 1)[-1] in NAMED


def pieces_of(path: str, text: str) -> list[Piece] | None:
    """The pieces of one tracked file, or None for a file that is no code."""
    name = path.rsplit("/", 1)[-1]
    suffix = suffix_of(path)
    if suffix in PYTHON:
        return list(python_pieces(text))
    if suffix in SCRIPT:
        return script_pieces(text, jsx=suffix in JSX)
    if suffix in SHELL or (not suffix and SHELL_SHEBANG.match(text) is not None):
        return shell_pieces(text)
    if suffix in DATA:
        return data_pieces(text, DATA[suffix])
    if name in NAMED:
        return data_pieces(text, NAMED[name])
    return None


def tracked(root: Path) -> tuple[list[str], frozenset[str]]:
    """Every tracked path, and those git marks generated."""
    listed = subprocess.run(("git", "-C", str(root), "ls-files", "-z"), capture_output=True, check=True)
    paths = [path for path in listed.stdout.decode("utf-8").split("\0") if path]
    attributes = subprocess.run(
        ("git", "-C", str(root), "check-attr", "-z", "--stdin", "linguist-generated"),
        input="\0".join(paths).encode("utf-8"),
        capture_output=True,
        check=True,
    )
    fields = attributes.stdout.decode("utf-8").split("\0")
    generated = frozenset(fields[at] for at in range(0, len(fields) - 2, 3) if fields[at + 2] in ("set", "true"))
    return paths, generated


def hits_in(name: str, stems: frozenset[str]) -> list[str]:
    return sorted({word for word in words(name) if word in stems})


def judge(root: Path, stems: frozenset[str]) -> list[Hit]:
    paths, generated = tracked(root)
    found: dict[tuple[str, int | None, str, str], None] = {}
    judged = 0
    for path in paths:
        for segment in path.split("/"):
            for stem in hits_in(segment, stems):
                found[(path, None, segment, stem)] = None
        if path in generated or path.rsplit("/", 1)[-1] in LOCKFILES or not may_be_code(path):
            continue
        try:
            text = (root / path).read_text(encoding="utf-8")
        except UNREADABLE as error:
            raise Unreadable(f"{path}: {error}") from error
        try:
            pieces = pieces_of(path, text)
        except Unplaceable as error:
            raise Unplaceable(f"{path}: {error}") from error
        if pieces is None:
            continue
        judged += 1
        for piece in pieces:
            if not is_name(piece) or (piece.literal and path in CATALOGUES):
                continue
            for stem in hits_in(piece.text, stems):
                found[(path, piece.line, piece.text, stem)] = None
    if judged == 0:
        raise NothingJudged("no tracked file is code this check reads")
    return [Hit(*key) for key in found]


def detail(hit: Hit) -> str:
    where = hit.path if hit.line is None else f"{hit.path}:{hit.line}"
    return f"{where}  {hit.name}  holds {hit.stem}"


def main(root: Path = REPO_ROOT) -> int:
    try:
        stems = frozenset((root / STEM_LIST).read_text(encoding="utf-8").split())
    except UNREADABLE as error:
        print(f"      {error}", file=sys.stderr)
        print(f"      Nothing was judged: {STEM_LIST} has to be readable.", file=sys.stderr)
        return EXIT_REFUSED
    if not stems:
        print(f"      Nothing was judged: {STEM_LIST} holds no stem.", file=sys.stderr)
        return EXIT_REFUSED
    try:
        hits = judge(root, stems)
    except (OSError, subprocess.CalledProcessError) as error:
        print(f"      {error}", file=sys.stderr)
        print("      Nothing was judged: the tracked files come from git, which has to answer.", file=sys.stderr)
        return EXIT_REFUSED
    except Unreadable as error:
        print(f"      {error}", file=sys.stderr)
        print("      Nothing was judged: every tracked code file has to read as utf-8.", file=sys.stderr)
        return EXIT_REFUSED
    except (Unplaceable, NothingJudged) as error:
        print(f"      {error}", file=sys.stderr)
        print("      This is a refusal rather than a verdict on the names.", file=sys.stderr)
        return EXIT_REFUSED

    code = report_findings(Finding("fail", detail(hit)) for hit in hits)
    if hits:
        print(f"\n      {len(hits)} name(s) above hold a stem of {STEM_LIST}: rename each to English by the glossary's rule.")
    return code


if __name__ == "__main__":
    sys.exit(run(main))
