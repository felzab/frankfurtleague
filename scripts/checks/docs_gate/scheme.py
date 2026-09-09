"""SCRIPTS · the season scheme files, held to one token list and to the palette's measured pairs.

One CSS file per season declares both theme blocks, and `globals.css` imports the season in force.
The population is the scheme DIRECTORY's listing rather than the files found declaring the tokens:
a file missing a token would drop out of a listing built that way instead of failing it (PRE-4).
The token list is the season in force, and `globals.css`'s `@theme` colour bridge is the second
route it has to agree with, so no file answers for its own contents.

Colour is read as the palette measured it: WCAG 2.x luminance for a ratio, Ottosson's OKLab L for a
hover step, an opacity class composited per channel in 8-bit sRGB. A value this cannot read as an
opaque colour is reported, never a pair silently skipped.

Invariants:
Every finding here names `scheme-token`; the run's exit code is `checks.py :: main`'s.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Final, Literal

from .kernel import REPO_ROOT, Finding, _read_text, scanned_files, tracked_page

CHECK: Final = "scheme-token"

SCHEME_DIR: Final = "fl_frontend/src/app/schemes"
# The directory, never a filename: a season's file is named for its season and the name moves.
SCHEME_GLOB: Final = f"{SCHEME_DIR}/*.css"
GLOBALS_PAGE: Final = "fl_frontend/src/app/globals.css"

Theme = Literal["light", "dark"]
THEMES: Final[tuple[Theme, ...]] = ("light", "dark")

# The one token the light block alone declares: `--focus` resolves to `var(--fg-base)` under
# `:root`, so it flips itself and a dark declaration would be a second spelling of the same rule.
LIGHT_ONLY: Final[frozenset[str]] = frozenset({"--focus"})

# --- reading a scheme file -----------------------------------------------------------------------

# Both selectors, so the bare `:root` a `prefers-reduced-motion` block opens is not a token block.
LIGHT_OPENER: Final = re.compile(r":root\s*,\s*\[data-theme=[\"']light[\"']\]\s*\{")
DARK_OPENER: Final = re.compile(r"\[data-theme=[\"']dark[\"']\]\s*\{")
DECL_RE: Final = re.compile(r"^\s*(--[a-z0-9-]+)\s*:\s*(.+?)\s*;", re.MULTILINE)
COMMENT_RE: Final = re.compile(r"/\*.*?\*/", re.DOTALL)


@dataclass(frozen=True, slots=True)
class Decl:
    value: str
    line: int


def _block(text: str, opener: re.Pattern[str]) -> tuple[str, int] | None:
    """One selector block's body and the line its opener sits on, or None where it is not there.

    Brace depth: no declaration below carries one, so counting parts the block from the layer.
    """
    match = opener.search(text)
    if match is None:
        return None
    depth = 1
    for offset in range(match.end(), len(text)):
        depth += {"{": 1, "}": -1}.get(text[offset], 0)
        if depth == 0:
            return text[match.end() : offset], text.count("\n", 0, match.start()) + 1
    return None


def _declarations(body: str, first: int) -> dict[str, Decl]:
    return {m.group(1): Decl(m.group(2), first + body.count("\n", 0, m.start())) for m in DECL_RE.finditer(body)}


@dataclass(frozen=True, slots=True)
class Scheme:
    """One scheme file's two token blocks, keyed by token name."""

    rel: str
    light: dict[str, Decl]
    dark: dict[str, Decl]
    missing: tuple[str, ...]

    def declared(self, theme: Theme) -> dict[str, Decl]:
        return self.light if theme == "light" else self.dark

    def resolve(self, theme: Theme, token: str) -> Decl | None:
        """The declaration in force, the light block standing in for what the dark one omits.

        `:root` matches under either theme, so an omitted dark token is the light block's value.
        """
        return self.dark.get(token) if theme == "dark" and token in self.dark else self.light.get(token)


def _read(path: Path) -> Scheme:
    rel = path.relative_to(REPO_ROOT).as_posix()
    raw = _read_text(path)[0]
    if raw is None:
        return Scheme(rel, {}, {}, ("light", "dark"))
    # Blanked rather than dropped, so a declaration keeps the line number a reader is sent to.
    text = COMMENT_RE.sub(lambda m: re.sub(r"[^\n]", " ", m.group(0)), raw)
    blocks: dict[str, dict[str, Decl]] = {}
    missing: list[str] = []
    for name, opener in (("light", LIGHT_OPENER), ("dark", DARK_OPENER)):
        found = _block(text, opener)
        if found is None:
            missing.append(name)
            blocks[name] = {}
        else:
            blocks[name] = _declarations(*found)
    return Scheme(rel, blocks["light"], blocks["dark"], tuple(missing))


def scheme_files() -> tuple[Path, ...]:
    """Every file the scheme directory holds, whatever each is named.

    The working tree rather than the index, for `scanned_files`' reason: a season added on this
    branch is the file whose tokens most need reading.
    """
    return tuple(path for path in scanned_files() if PurePosixPath(path.relative_to(REPO_ROOT).as_posix()).full_match(SCHEME_GLOB))


# --- what globals.css states about the scheme ----------------------------------------------------

IMPORT_RE: Final = re.compile(r"""@import\s+["']([^"']*schemes/[^"']+)["']""")
BRIDGE_RE: Final = re.compile(r"^\s*--color-[a-z0-9-]+\s*:\s*var\((--[a-z0-9-]+)\)\s*;", re.MULTILINE)
THEME_OPENER: Final = re.compile(r"@theme\s*\{")
COLOUR_DECL_RE: Final = re.compile(r"^\s*(--color-[a-z0-9-]+)\s*:\s*(.+?)\s*;", re.MULTILINE)
VAR_ONLY_RE: Final = re.compile(r"var\(--[a-z0-9-]+\)")


def _globals_text() -> str | None:
    page = tracked_page(GLOBALS_PAGE)
    return None if page is None else _read_text(page)[0]


def _imports(text: str) -> list[str]:
    """Every scheme `globals.css` imports, in source order."""
    return IMPORT_RE.findall(text)


def _designated(text: str) -> str | None:
    """The scheme file the site is wired to, as `globals.css` spells the import."""
    return next(iter(_imports(text)), None)


def _theme_body(text: str) -> str:
    """The `@theme` block alone: Tailwind emits a utility for nothing outside it."""
    block = _block(text, THEME_OPENER)
    return "" if block is None else block[0]


def _bridged(text: str) -> frozenset[str]:
    """Every token the `@theme` colour bridge resolves, which is the token list's second route."""
    return frozenset(BRIDGE_RE.findall(_theme_body(text)))


def _literal_bridges(text: str) -> list[str]:
    """A `--color-*` holding a value rather than a `var()`, which no season answers for."""
    return sorted(name for name, value in COLOUR_DECL_RE.findall(_theme_body(text)) if VAR_ONLY_RE.fullmatch(value) is None)


# --- colour --------------------------------------------------------------------------------------

HEX_RE: Final = re.compile(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
VAR_RE: Final = re.compile(r"^var\(\s*(--[a-z0-9-]+)\s*\)$")

Rgb = tuple[int, int, int]


def _hex_rgb(value: str) -> Rgb | None:
    match = HEX_RE.match(value)
    if match is None:
        return None
    digits = match.group(1)
    if len(digits) == 3:
        digits = "".join(c * 2 for c in digits)
    return int(digits[0:2], 16), int(digits[2:4], 16), int(digits[4:6], 16)


def _colour(scheme: Scheme, theme: Theme, token: str) -> Rgb | None:
    """One token as an opaque colour, following at most one `var()` hop.

    Hex only: `emailShell.test.ts` reads the same file with a hex-only regex, so a token written
    any other way is already outside what the scheme may carry.
    """
    declaration = scheme.resolve(theme, token)
    if declaration is None:
        return None
    value = declaration.value
    if (indirect := VAR_RE.match(value)) is not None:
        target = scheme.resolve(theme, indirect.group(1))
        value = "" if target is None else target.value
    return _hex_rgb(value)


def _linear(channel: int, threshold: float) -> float:
    ratio = channel / 255
    return ratio / 12.92 if ratio <= threshold else ((ratio + 0.055) / 1.055) ** 2.4


def _luminance(rgb: Rgb) -> float:
    """WCAG 2.x relative luminance, at the 0.03928 knee that specification writes."""
    red, green, blue = (_linear(channel, 0.03928) for channel in rgb)
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def contrast(top: Rgb, bottom: Rgb) -> float:
    high, low = sorted((_luminance(top), _luminance(bottom)), reverse=True)
    return (high + 0.05) / (low + 0.05)


def lightness(rgb: Rgb) -> float:
    """OKLab L per Ottosson's matrices, which is what `oklch()` resolves through as well."""
    red, green, blue = (_linear(channel, 0.04045) for channel in rgb)
    long = 0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue
    medium = 0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue
    short = 0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue
    cube = [value ** (1 / 3) for value in (long, medium, short)]
    return 0.2104542553 * cube[0] + 0.7936177850 * cube[1] - 0.0040720468 * cube[2]


def composite(top: Rgb, percent: int, ground: Rgb) -> Rgb:
    """An opacity class blended per channel in 8-bit sRGB, which is how the browser paints one."""
    alpha = percent / 100
    blended = (round(t * alpha + g * (1 - alpha)) for t, g in zip(top, ground, strict=True))
    return tuple(blended)  # type: ignore[return-value]


def _shown(ratio: float) -> str:
    """Truncated, never rounded: a figure printed as its floor never reads as clearing one."""
    return f"{math.floor(ratio * 100) / 100:.2f}"


# --- the palette's tables ------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Layer:
    """A token, optionally at a Tailwind opacity class over the ground it is painted on."""

    token: str
    percent: int = 100
    over: str | None = None

    def spell(self) -> str:
        return self.token if self.over is None else f"{self.token}/{self.percent} over {self.over}"


@dataclass(frozen=True, slots=True)
class Pair:
    site: str
    top: Layer
    bottom: Layer
    floor: float
    themes: tuple[Theme, ...] = THEMES


# A ring or a component boundary answers to 3:1 and text to 4.5:1; a pair the palette records
# without a floor is a design conclusion and is not here (`docs/_standard/standard.md :: CUR-8`).
PAIRS: Final[tuple[Pair, ...]] = (
    Pair("", Layer("--fg-base"), Layer("--bg-base"), 4.5),
    Pair("", Layer("--fg-base"), Layer("--bg-surface"), 4.5),
    Pair("", Layer("--fg-base"), Layer("--bg-muted"), 4.5),
    Pair("", Layer("--fg-muted"), Layer("--bg-base"), 4.5),
    Pair("", Layer("--fg-muted"), Layer("--bg-surface"), 4.5),
    Pair("", Layer("--fg-muted"), Layer("--bg-muted"), 4.5),
    # A field wears --bg-surface on a panel wearing the same, so its border is the whole of what
    # says "field" and WCAG 1.4.11's 3:1 reaches it; a box's decorative hairline is exempt.
    Pair("a field at rest", Layer("--border-control"), Layer("--bg-surface"), 3.0),
    Pair("a field at rest, in a modal", Layer("--border-control"), Layer("--bg-base"), 3.0),
    Pair("focus ring", Layer("--focus"), Layer("--bg-base"), 3.0),
    Pair("focus ring", Layer("--focus"), Layer("--bg-surface"), 3.0),
    Pair("collection option keyboard ring", Layer("--focus"), Layer("--bg-hover"), 3.0),
    Pair("", Layer("--fg-on-brand"), Layer("--accent-brand-solid"), 4.5),
    Pair("", Layer("--fg-on-brand"), Layer("--accent-brand-solid-hover"), 4.5),
    Pair("", Layer("--accent-brand"), Layer("--bg-base"), 4.5),
    Pair("", Layer("--accent-brand"), Layer("--bg-surface"), 4.5),
    Pair("", Layer("--accent-brand"), Layer("--bg-muted"), 4.5),
    # WCAG G183: a link is told from its sentence by colour alone. Light only, the dark brand
    # being lighter than the body text rather than darker.
    Pair("a link told from its sentence, G183", Layer("--accent-brand"), Layer("--fg-base"), 3.0, ("light",)),
    Pair("calendar today outline", Layer("--accent-brand"), Layer("--bg-surface"), 3.0),
    Pair("brand pill, sidemenu active row", Layer("--accent-brand"), Layer("--accent-brand", 15, "--bg-surface"), 4.5),
    Pair("BewerbungView eyebrow", Layer("--fg-on-brand", 75, "--accent-brand-solid"), Layer("--accent-brand-solid"), 4.5),
    Pair("BrandHero wordmark", Layer("--accent-on-brand"), Layer("--accent-brand-solid"), 4.5),
    Pair("FilterPanel selected row", Layer("--fg-base"), Layer("--accent-brand-solid", 20, "--bg-surface"), 4.5),
    Pair("FilterPanel selected row, hovered", Layer("--fg-base"), Layer("--accent-brand-solid", 30, "--bg-surface"), 4.5),
    Pair("FilterPanel picked row, check", Layer("--accent-brand"), Layer("--accent-brand-solid", 20, "--bg-surface"), 3.0),
    Pair("FilterPanel picked row, check, hovered", Layer("--accent-brand"), Layer("--accent-brand-solid", 30, "--bg-surface"), 3.0),
    Pair("FilterPanel picked row, check, under the keyboard", Layer("--accent-brand"), Layer("--bg-hover"), 3.0),
    Pair("", Layer("--accent-success-strong"), Layer("--bg-muted"), 4.5),
    Pair("", Layer("--accent-success-strong"), Layer("--bg-surface"), 4.5),
    Pair("badge, Callout", Layer("--accent-success-strong"), Layer("--accent-success", 15, "--bg-surface"), 4.5),
    Pair("dot, timer bar", Layer("--accent-success"), Layer("--bg-surface"), 3.0),
    Pair("result badge, count on a recessed track", Layer("--fg-on-success"), Layer("--accent-success-solid"), 4.5),
    Pair("", Layer("--accent-warn-strong"), Layer("--bg-muted"), 4.5),
    Pair("", Layer("--accent-warn-strong"), Layer("--bg-surface"), 4.5),
    Pair("badge, Callout", Layer("--accent-warn-strong"), Layer("--accent-warn", 15, "--bg-surface"), 4.5),
    Pair("dot, timer bar", Layer("--accent-warn"), Layer("--bg-surface"), 3.0),
    Pair("result badge, count on a recessed track", Layer("--fg-on-warn"), Layer("--accent-warn-solid"), 4.5),
    Pair("", Layer("--accent-danger-strong"), Layer("--bg-muted"), 4.5),
    Pair("", Layer("--accent-danger-strong"), Layer("--bg-surface"), 4.5),
    Pair("badge, Callout", Layer("--accent-danger-strong"), Layer("--accent-danger", 15, "--bg-surface"), 4.5),
    Pair("dot, timer bar", Layer("--accent-danger"), Layer("--bg-surface"), 3.0),
    Pair("result badge, count on a recessed track", Layer("--fg-on-danger"), Layer("--accent-danger-solid"), 4.5),
    Pair("the tightest pair", Layer("--fg-on-danger"), Layer("--accent-danger-solid-hover"), 4.5),
    Pair("", Layer("--accent-info-strong"), Layer("--bg-muted"), 4.5),
    Pair("", Layer("--accent-info-strong"), Layer("--bg-surface"), 4.5),
    Pair("badge, Callout", Layer("--accent-info-strong"), Layer("--accent-info", 15, "--bg-surface"), 4.5),
    Pair("dot, timer bar", Layer("--accent-info"), Layer("--bg-surface"), 3.0),
    Pair("count on a recessed track", Layer("--fg-on-info"), Layer("--accent-info-solid"), 4.5),
    Pair("phase badge", Layer("--accent-phase-gruppenphase"), Layer("--accent-phase-gruppenphase", 15, "--bg-surface"), 4.5),
    Pair("phase badge", Layer("--accent-phase-achtelfinale"), Layer("--accent-phase-achtelfinale", 15, "--bg-surface"), 4.5),
    Pair("phase badge", Layer("--accent-phase-viertelfinale"), Layer("--accent-phase-viertelfinale", 15, "--bg-surface"), 4.5),
    Pair("phase badge", Layer("--accent-phase-halbfinale"), Layer("--accent-phase-halbfinale", 15, "--bg-surface"), 4.5),
    Pair("phase badge", Layer("--accent-phase-finale"), Layer("--accent-phase-finale", 15, "--bg-surface"), 4.5),
)


@dataclass(frozen=True, slots=True)
class Hover:
    """A hover fill, the ground it steps off, and which way it steps in each theme."""

    token: str
    ground: str
    light: int
    dark: int

    def direction(self, theme: Theme) -> int:
        return self.light if theme == "light" else self.dark


# One declared colour per family rather than an alpha, so the step is measured and not composited.
# Light steps down off a page ground and up off a fill; dark steps up off both.
HOVERS: Final[tuple[Hover, ...]] = (
    Hover("--bg-hover", "--bg-surface", -1, 1),
    Hover("--bg-hover-muted", "--bg-muted", -1, 1),
    Hover("--bg-hover-danger", "--bg-surface", -1, 1),
    Hover("--accent-brand-solid-hover", "--accent-brand-solid", 1, 1),
    Hover("--accent-danger-solid-hover", "--accent-danger-solid", 1, 1),
)
STEP: Final = 6.7
# Wide enough for a colour solved to the nearest 8-bit hex, far too narrow for a missing step.
STEP_TOLERANCE: Final = 0.5

# An alpha composites against whatever is behind, so the same class lands differently on every
# surface -- the reason the hover fills are declared colours.
ALPHA_RE: Final = re.compile(r"color-mix|transparent|rgba\(|hsla\(|#[0-9a-fA-F]{8}\b|/\s*[\d.]+%?\s*\)")


@dataclass(frozen=True, slots=True)
class Ordering:
    """One lightness the palette requires, read as `lighter` being lighter than `darker`."""

    lighter_theme: Theme
    lighter: str
    darker_theme: Theme
    darker: str


# The one the scheme file states in a comment and asserted nowhere.
ORDERINGS: Final[tuple[Ordering, ...]] = (
    Ordering("dark", "--accent-brand", "dark", "--accent-brand-solid"),
    # The inversion the scheme states beside them: on a dark surface a text grade is LIGHTER
    # than the fill it answers to.
    Ordering("dark", "--accent-success-strong", "dark", "--accent-success"),
    Ordering("dark", "--accent-warn-strong", "dark", "--accent-warn"),
    Ordering("dark", "--accent-danger-strong", "dark", "--accent-danger"),
    Ordering("dark", "--accent-info-strong", "dark", "--accent-info"),
    # A different claim, which a theme merely lightened already passes: each dark text grade
    # above its own light twin.
    Ordering("dark", "--accent-success-strong", "light", "--accent-success-strong"),
    Ordering("dark", "--accent-warn-strong", "light", "--accent-warn-strong"),
    Ordering("dark", "--accent-danger-strong", "light", "--accent-danger-strong"),
    Ordering("dark", "--accent-info-strong", "light", "--accent-info-strong"),
)


# --- the arms ------------------------------------------------------------------------------------


def _fail(rel: str, detail: str, line: int | None = None) -> Finding:
    return Finding("fail", CHECK, rel, detail, line)


def _bridge_findings(bridged: frozenset[str], roster: frozenset[str]) -> list[Finding]:
    """The `@theme` bridge against the token list, which is what stops the list certifying itself.

    A season file alone would answer for its own contents: this is the route that does not.
    """
    if not bridged:
        detail = "declares no `--color-*: var(--token)` bridge, so the season's token list was checked against nothing"
        return [_fail(GLOBALS_PAGE, detail)]
    return [
        _fail(GLOBALS_PAGE, f"bridges `{token}`, which the season declares nowhere -- it resolves to nothing and the property is dropped")
        for token in sorted(bridged - roster)
    ]


def _parity_findings(scheme: Scheme, roster: frozenset[str]) -> list[Finding]:
    """Each block against the season in force, which is the one token list every file carries."""
    found = [_fail(scheme.rel, f"declares no `{name}` token block, so the theme it carries was read from nothing") for name in scheme.missing]
    for theme in THEMES:
        if theme in scheme.missing:
            continue
        expected = {token for token in roster if theme == "light" or token not in LIGHT_ONLY}
        declared = set(scheme.declared(theme))
        for token in sorted(expected - declared):
            found.append(_fail(scheme.rel, f"the {theme} block declares no `{token}` -- every scheme file carries the one token list"))
        for token in sorted(declared - expected):
            reason = "the light block alone declares it" if token in LIGHT_ONLY else "the season in force does not"
            found.append(_fail(scheme.rel, f"the {theme} block declares `{token}` and {reason}", scheme.declared(theme)[token].line))
    return found


def _is_alpha_hover(scheme: Scheme, theme: Theme, token: str) -> bool:
    declaration = scheme.resolve(theme, token)
    return "hover" in token and declaration is not None and ALPHA_RE.search(declaration.value) is not None


def _alpha_findings(scheme: Scheme) -> list[Finding]:
    """A hover token spelled with an alpha or a mix to transparent."""
    found: list[Finding] = []
    for theme in THEMES:
        for token, declaration in scheme.declared(theme).items():
            if "hover" in token and ALPHA_RE.search(declaration.value):
                detail = f"`{token}` carries an alpha -- a hover fill composites against what is behind it and lands differently everywhere"
                found.append(_fail(scheme.rel, detail, declaration.line))
    return found


def _measure(scheme: Scheme, theme: Theme, layer: Layer) -> Rgb | None:
    """One layer as a painted colour, or None where a token it names cannot be read."""
    # A percentage with no ground measures the opaque colour and passes a pair nothing paints.
    # Raised here rather than at the table, whose rows are built before `run` can call it a crash.
    if (layer.percent == 100) != (layer.over is None):
        raise ValueError(f"`{layer.token}` at {layer.percent}% names {'no' if layer.over is None else 'a'} ground")
    top = _colour(scheme, theme, layer.token)
    if top is None or layer.over is None:
        return top
    ground = _colour(scheme, theme, layer.over)
    return None if ground is None else composite(top, layer.percent, ground)


def _contrast_findings(scheme: Scheme) -> list[Finding]:
    """Every pair the palette records with a floor, re-measured on the values this file declares."""
    found: list[Finding] = []
    for pair in PAIRS:
        for theme in pair.themes:
            top = _measure(scheme, theme, pair.top)
            bottom = _measure(scheme, theme, pair.bottom)
            if top is None or bottom is None:
                continue  # `_unreadable_findings` names the token, once, whichever arms wanted it.
            ratio = contrast(top, bottom)
            if ratio < pair.floor:
                site = f" ({pair.site})" if pair.site else ""
                detail = (
                    f"{theme}: `{pair.top.spell()}` on `{pair.bottom.spell()}`{site} measures "
                    f"{_shown(ratio)}:1 against a floor of {pair.floor:.2f}:1"
                )
                found.append(_fail(scheme.rel, detail))
    return found


def _measured(theme: Theme) -> frozenset[str]:
    """Every token the three measuring arms name under one theme."""
    tokens = {order.lighter for order in ORDERINGS if order.lighter_theme == theme}
    tokens |= {order.darker for order in ORDERINGS if order.darker_theme == theme}
    tokens |= {token for hover in HOVERS for token in (hover.token, hover.ground)}
    for pair in PAIRS:
        if theme in pair.themes:
            tokens |= {layer.token for layer in (pair.top, pair.bottom)}
            tokens |= {layer.over for layer in (pair.top, pair.bottom) if layer.over is not None}
    return frozenset(tokens)


def _unreadable_findings(scheme: Scheme) -> list[Finding]:
    """Every token the measuring arms name, held to a colour they can read.

    Here rather than inside each arm: a hover fill in no pair at all would be skipped by the only
    arm that reads it.
    """
    found: list[Finding] = []
    for theme in THEMES:
        for token in sorted(_measured(theme)):
            if _colour(scheme, theme, token) is not None or _is_alpha_hover(scheme, theme, token):
                continue  # A hover fill's alpha is one defect, and `_alpha_findings` owns it.
            detail = f"the {theme} `{token}` is not an opaque hex colour, so every pair and step against it went unmeasured"
            found.append(_fail(scheme.rel, detail))
    return found


def _hover_findings(scheme: Scheme) -> list[Finding]:
    """The OKLab step each hover fill keeps off the ground it answers to."""
    found: list[Finding] = []
    for theme in THEMES:
        for hover in HOVERS:
            fill, ground = _colour(scheme, theme, hover.token), _colour(scheme, theme, hover.ground)
            if fill is None or ground is None:
                continue  # `_unreadable_findings` has named it.
            step = (lightness(fill) - lightness(ground)) * 100
            wanted = hover.direction(theme) * STEP
            if abs(step - wanted) > STEP_TOLERANCE:
                detail = (
                    f"{theme}: `{hover.token}` sits {step:+.2f} OKLab L points off `{hover.ground}`, where every hover fill steps {wanted:+.1f}"
                )
                found.append(_fail(scheme.rel, detail))
    return found


def _ordering_findings(scheme: Scheme) -> list[Finding]:
    """The lightness ordering the dark theme requires, which the file states and asserts nowhere."""
    found: list[Finding] = []
    for order in ORDERINGS:
        lighter = _colour(scheme, order.lighter_theme, order.lighter)
        darker = _colour(scheme, order.darker_theme, order.darker)
        if lighter is None or darker is None:
            continue  # `_unreadable_findings` has named it.
        if lightness(lighter) <= lightness(darker):
            detail = (
                f"the {order.lighter_theme} `{order.lighter}` is not lighter than the {order.darker_theme} `{order.darker}` "
                f"({lightness(lighter):.3f} against {lightness(darker):.3f})"
            )
            found.append(_fail(scheme.rel, detail))
    return found


def check_scheme_tokens() -> list[Finding]:
    """Every season scheme file against one token list, and the palette's floors re-measured."""
    text = _globals_text()
    files = scheme_files()
    if text is None:
        # Its own finding, never a delegation: `checks.py :: REQUIRED_INPUTS` does not name this
        # page, so returning empty would take every arm below silent with it.
        if not files:
            return []
        return [_fail(GLOBALS_PAGE, f"is not in the corpus, so `{SCHEME_DIR}`'s files were held against no token list")]
    designated = _designated(text)
    if designated is None and not files:
        return []

    found: list[Finding] = []
    if not files:
        found.append(_fail(SCHEME_DIR, "holds no scheme file, so the season's token list was held over nothing"))
    if designated is None:
        found.append(_fail(GLOBALS_PAGE, f"imports no file from `{SCHEME_DIR}` -- a scheme nothing imports styles nothing"))
    wanted = "" if designated is None else designated.rsplit("/", 1)[-1]
    season = next((path for path in files if path.name == wanted), None)
    if designated is not None and season is None:
        found.append(_fail(GLOBALS_PAGE, f"imports `{designated}`, which `{SCHEME_DIR}` does not hold -- the import resolves to nothing"))
    # The season in force is the token list; without it there is no list, and every arm below would
    # be measuring one file against itself.
    roster = frozenset() if season is None else frozenset(_read(season).light)
    found.extend(
        _fail(GLOBALS_PAGE, f"bridges `{name}` to a value rather than to a season token -- the scheme answers for it nowhere")
        for name in _literal_bridges(text)
    )
    found.extend(
        _fail(GLOBALS_PAGE, f"imports `{extra}` as well -- the last import wins, so the season in force is not the designated one")
        for extra in _imports(text)[1:]
    )
    if season is not None:
        found.extend(_bridge_findings(_bridged(text), roster))

    for path in files:
        scheme = _read(path)
        if season is not None:
            found.extend(_parity_findings(scheme, roster))
        found.extend(_alpha_findings(scheme))
        found.extend(_unreadable_findings(scheme))
        found.extend(_contrast_findings(scheme))
        found.extend(_hover_findings(scheme))
        found.extend(_ordering_findings(scheme))
    return found
