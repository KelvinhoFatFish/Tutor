#!/usr/bin/env python3
"""
verify_luau.py -- structural and hygiene checker for the RIVALS Luau sources.

Not a type checker, and not a substitute for Studio's script analysis, but a fast
offline pass that catches the mistakes which are easy to make when writing a lot
of Luau quickly:

  1.  Unbalanced brackets and unterminated strings, with comments and long
      brackets handled correctly.
  2.  Block keyword balance (function/if/for/while/do/repeat vs end/until),
      including the `for ... do` / `while ... do` double-count trap.
  3.  Globals that do not exist in Roblox Luau (io, dofile, ...).
  4.  A local function called above its own definition, which is a runtime
      nil-index rather than a compile error.
  5.  Leftover TODO/FIXME markers and a missing module return.

Luau type annotations are the main hazard for a lexer this simple: they contain
braces (`{ [string]: any }`), generics (`map<K, V>`) and arrows (`() -> boolean`),
all of which confuse naive bracket and keyword counting. Annotations are
therefore masked out before the structural checks run.

Usage:  python verify_luau.py <root-dir>
Exit code 0 = clean, 1 = findings.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

# ---------------------------------------------------------------------------
# Findings
# ---------------------------------------------------------------------------


@dataclass
class Finding:
    line: int
    severity: str  # "error" | "warn"
    message: str


@dataclass
class FileReport:
    path: Path
    findings: list[Finding] = field(default_factory=list)

    @property
    def errors(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "error"]

    @property
    def warnings(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "warn"]


# ---------------------------------------------------------------------------
# Tokenizer
# ---------------------------------------------------------------------------

NAME, NUMBER, STRING, OP = "name", "number", "string", "op"
IDENT_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
KEYWORDS = frozenset(
    """
    and break do else elseif end false for function if in local nil not or repeat
    return then true until while continue export type
    """.split()
)


@dataclass
class Token:
    kind: str
    text: str
    line: int
    start: int
    end: int


def _long_bracket_level(text: str, pos: int) -> int | None:
    """If a long bracket opens at pos, return its '=' level."""
    if pos >= len(text) or text[pos] != "[":
        return None
    j = pos + 1
    level = 0
    while j < len(text) and text[j] == "=":
        level += 1
        j += 1
    if j < len(text) and text[j] == "[":
        return level
    return None


MULTI_OPS = ("...", "..", "==", "~=", "<=", ">=", "::", "->", "+=", "-=", "*=", "/=", "%=", "^=", "//")


def tokenize(text: str) -> list[Token]:
    tokens: list[Token] = []
    n = len(text)
    i = 0
    line = 1

    while i < n:
        ch = text[i]

        if ch == "\n":
            line += 1
            i += 1
            continue
        if ch in " \t\r\f\v":
            i += 1
            continue

        # Comment
        if text.startswith("--", i):
            level = _long_bracket_level(text, i + 2)
            if level is not None:
                close = "]" + "=" * level + "]"
                end = text.find(close, i + 3 + level)
                end = n if end == -1 else end + len(close)
            else:
                end = text.find("\n", i)
                end = n if end == -1 else end
            line += text.count("\n", i, end)
            i = end
            continue

        # Long string
        level = _long_bracket_level(text, i)
        if level is not None:
            close = "]" + "=" * level + "]"
            start_line = line
            end = text.find(close, i + 2 + level)
            end = n if end == -1 else end + len(close)
            line += text.count("\n", i, end)
            tokens.append(Token(STRING, "<long string>", start_line, i, end))
            i = end
            continue

        # Quoted string
        if ch in ("'", '"'):
            start_line, start = line, i
            j = i + 1
            terminated = False
            while j < n:
                if text[j] == "\\":
                    j += 2
                    continue
                if text[j] == ch:
                    j += 1
                    terminated = True
                    break
                if text[j] == "\n":
                    break
                j += 1
            if terminated:
                tokens.append(Token(STRING, "<string>", start_line, start, j))
            else:
                tokens.append(Token(OP, "UNTERMINATED_STRING", start_line, start, j))
            line += text.count("\n", i, j)
            i = j
            continue

        # Identifier / keyword
        match = IDENT_RE.match(text, i)
        if match:
            tokens.append(Token(NAME, match.group(0), line, i, match.end()))
            i = match.end()
            continue

        # Number (loose -- we only need it to not look like a name)
        if ch.isdigit() or (ch == "." and i + 1 < n and text[i + 1].isdigit()):
            j = i
            while j < n and (text[j].isalnum() or text[j] in "._"):
                j += 1
            tokens.append(Token(NUMBER, text[i:j], line, i, j))
            i = j
            continue

        # Multi-character operator
        matched = None
        for op in MULTI_OPS:
            if text.startswith(op, i):
                matched = op
                break
        if matched:
            tokens.append(Token(OP, matched, line, i, i + len(matched)))
            i += len(matched)
            continue

        tokens.append(Token(OP, ch, line, i, i + 1))
        i += 1

    return tokens


# ---------------------------------------------------------------------------
# Type annotation masking
# ---------------------------------------------------------------------------

TYPE_END = frozenset({"=", ",", ";"})


def mask_type_annotations(tokens: list[Token]) -> set[int]:
    """Return indices of tokens that belong to type annotations.

    Luau type syntax always begins with `:` (after a name) or `->` (a return
    type) and ends at a top-level `=`/`,`/`;`, a `then`, or end of line. Masking
    these keeps braces, generics and arrows out of the structural checks.

    Indices are 0-based, matching the order of `tokens`, so callers can filter
    with `enumerate(tokens)` directly.
    """
    masked: set[int] = set()
    index = 0
    total = len(tokens)

    while index < total:
        token = tokens[index]
        is_type_start = False

        if token.kind == OP and token.text == "->":
            is_type_start = True
        elif token.kind == OP and token.text == ":":
            # A type annotation, as opposed to a method call `obj:method()`.
            nxt = tokens[index + 1] if index + 1 < total else None
            after = tokens[index + 2] if index + 2 < total else None
            if nxt and nxt.kind == NAME and nxt.text not in KEYWORDS:
                is_method_call = after is not None and after.kind == OP and after.text == "("
                if not is_method_call:
                    is_type_start = True

        if not is_type_start:
            index += 1
            continue

        # Walk forward to the end of the annotation.
        depth = 0
        start_line = token.line
        cursor = index
        while cursor < total:
            current = tokens[cursor]
            if current.line != start_line and depth == 0:
                break
            if current.kind == OP:
                if current.text in "([{":
                    depth += 1
                elif current.text in ")]}":
                    depth -= 1
                    if depth < 0:
                        break
                elif depth == 0 and current.text in TYPE_END:
                    break
            if current.kind == NAME and current.text in ("then", "do", "end") and depth == 0:
                break
            masked.add(cursor)
            cursor += 1

        index = cursor if cursor > index else index + 1

    return masked


# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

OPEN_BRACKETS = {"(": ")", "[": "]", "{": "}"}
CLOSE_BRACKETS = {")": "(", "]": "[", "}": "{"}

SAFE_GLOBALS = frozenset(
    """
    game workspace script shared plugin
    print warn error assert pcall xpcall select type typeof tostring tonumber
    pairs ipairs next rawget rawset rawequal rawlen setmetatable getmetatable
    unpack require newproxy tick time wait delay spawn task collectgarbage
    math string table coroutine bit32 utf8 os debug buffer vector
    Instance Vector3 Vector2 Vector3int16 Vector2int16 CFrame Color3 BrickColor
    ColorSequence ColorSequenceKeypoint NumberSequence NumberSequenceKeypoint
    NumberRange Rect Region3 Region3int16 Ray Random TweenInfo Enum Font Faces Axes
    PhysicalProperties DateTime PathWaypoint OverlapParams RaycastParams
    CatalogSearchParams DockWidgetPluginGuiInfo FloatCurveKey RotationCurveKey
    SharedTable Content UDim UDim2 world settings stats getfenv setfenv getgenv
    loadstring _G _VERSION
    """.split()
)

FORBIDDEN_GLOBALS = {
    "io": "Roblox has no filesystem access",
    "dofile": "Roblox has no filesystem access",
    "loadfile": "Roblox has no filesystem access",
    "module": "use `return <table>` instead of the legacy module() idiom",
}

# Luau built-in types, so a type annotation we failed to mask does not get
# reported as an undeclared global.
TYPE_NAMES = frozenset(
    """
    any boolean number string thread table userdata nil void never unknown
    Vector3 Vector2 CFrame Color3 BrickColor Instance Enum Random TweenInfo
    Ray RaycastParams OverlapParams NumberRange NumberSequence ColorSequence
    UDim UDim2 Rect Region3 Axes Faces PhysicalProperties DateTime buffer
    """.split()
)

BLOCK_OPENERS = {"function", "if", "for", "while", "do", "repeat"}
BLOCK_CLOSERS = {"end", "until"}


def check_brackets(tokens: list[Token], report: FileReport) -> None:
    stack: list[tuple[str, int]] = []
    for token in tokens:
        if token.kind == OP and token.text == "UNTERMINATED_STRING":
            report.findings.append(Finding(token.line, "error", "unterminated string literal"))
            continue
        if token.kind != OP:
            continue
        if token.text in OPEN_BRACKETS:
            stack.append((token.text, token.line))
        elif token.text in CLOSE_BRACKETS:
            if not stack:
                report.findings.append(Finding(token.line, "error", f"unmatched closing '{token.text}'"))
                return
            top, top_line = stack.pop()
            if top != CLOSE_BRACKETS[token.text]:
                report.findings.append(
                    Finding(
                        token.line,
                        "error",
                        f"'{token.text}' closes '{top}' opened on line {top_line}",
                    )
                )
                return
    for opener, opener_line in stack:
        report.findings.append(Finding(opener_line, "error", f"unclosed '{opener}'"))


def inline_if_lines(text: str, tokens: list[Token]) -> set[int]:
    """Lines whose `if` begins an inline if-*expression* rather than a statement.

    `local x = if c then a else b` is an expression and takes no `end`, so
    counting it as a block opener reports a false imbalance.

    Two signals are used together, because neither is sufficient alone:

    1. The `if` must be *introduced* by something that expects a value: `=`,
       `return`, `(`, `,`, `[`, `then` or `else`. A statement `if` is not.
    2. Its `else` must be indented deeper than the `if`, or share the `if`'s
       line. In a statement, `else` always aligns with its `if`; in a
       multi-line expression the continuation is indented a level further.

    Indentation is only consulted for this single decision, so a file with
    unusual formatting degrades to signal 1 alone rather than to nonsense.
    """
    lines = text.splitlines()

    def indent_of(line_number: int) -> int:
        if 1 <= line_number <= len(lines):
            source = lines[line_number - 1]
            return len(source) - len(source.lstrip())
        return 0

    inline: set[int] = set()
    for index, token in enumerate(tokens):
        if token.kind != NAME or token.text != "if":
            continue

        prev = tokens[index - 1] if index > 0 else None
        introduced = prev is not None and (
            (prev.kind == OP and prev.text in ("=", "(", ",", "["))
            or (prev.kind == NAME and prev.text in ("return", "then", "else"))
        )
        if not introduced:
            continue

        # Find the matching `else` (or bail at `end`/`elseif`/a later `if`).
        depth = 0
        for cursor in range(index + 1, len(tokens)):
            current = tokens[cursor]
            if current.kind == OP:
                if current.text in "([{":
                    depth += 1
                elif current.text in ")]}":
                    depth -= 1
                continue
            if current.kind != NAME or depth != 0:
                continue
            if current.text == "then":
                continue
            if current.text == "else":
                if current.line == token.line or indent_of(current.line) > indent_of(token.line):
                    inline.add(token.line)
                break
            if current.text in ("end", "elseif", "if", "do"):
                break
    return inline


def check_blocks(tokens: list[Token], report: FileReport, inline_if_lines: set[int]) -> None:
    """Count block openers against end/until, tracking `do` ownership.

    `for i = 1, 10 do` and `while cond do` carry a `do` that belongs to the loop
    header. Counting both would report one false imbalance per loop, so a `do`
    that follows a pending loop header is attributed to that header.

    Inline if-expressions are skipped entirely: they take no `end`.
    """
    depth = 0
    pending_loop = 0
    last_line = 1

    for token in tokens:
        if token.kind != NAME:
            continue
        last_line = token.line
        word = token.text
        if word in ("for", "while"):
            depth += 1
            pending_loop += 1
        elif word == "if":
            if token.line in inline_if_lines:
                continue
            depth += 1
        elif word == "function" or word == "repeat":
            depth += 1
        elif word == "do":
            if pending_loop > 0:
                pending_loop -= 1
            else:
                depth += 1
        elif word in BLOCK_CLOSERS:
            depth -= 1
            if depth < 0:
                report.findings.append(Finding(token.line, "error", f"extra '{word}'"))
                return

    if depth != 0:
        report.findings.append(
            Finding(last_line, "error", f"block imbalance: depth {depth} at end of file")
        )


def check_globals(tokens: list[Token], report: FileReport) -> None:
    """Report identifiers that are neither locals, parameters, nor known globals.

    A full scope walk is out of scope here, so this is deliberately conservative:
    anything declared anywhere in the file with `local`, or appearing as a
    parameter name, is treated as declared. The value of the check is the
    forbidden-global case (io, dofile) and typos in genuinely global names.
    """
    declared: set[str] = set()
    for index, token in enumerate(tokens):
        if token.kind == NAME and token.text == "local":
            cursor = index + 1
            if cursor < len(tokens) and tokens[cursor].kind == NAME and tokens[cursor].text == "function":
                cursor += 1
            while cursor < len(tokens):
                if tokens[cursor].kind != NAME:
                    break
                declared.add(tokens[cursor].text)
                cursor += 1
                if cursor < len(tokens) and tokens[cursor].kind == OP and tokens[cursor].text == ",":
                    cursor += 1
                    continue
                break

    # Loop variables: `for a, b in ... do` and `for i = 1, n do`.
    for index, token in enumerate(tokens):
        if token.kind != NAME or token.text != "for":
            continue
        cursor = index + 1
        while cursor < len(tokens):
            current = tokens[cursor]
            if current.kind == NAME and current.text not in KEYWORDS:
                declared.add(current.text)
            elif current.kind == OP and current.text == ",":
                pass
            elif current.kind == NAME and current.text in ("in", "do"):
                break
            elif current.kind == OP and current.text == "=":
                pass
            cursor += 1

    # Named function parameters and anonymous function parameters.
    for index, token in enumerate(tokens):
        if token.kind != NAME or token.text != "function":
            continue
        cursor = index + 1
        # Optional function name.
        if cursor < len(tokens) and tokens[cursor].kind == NAME and tokens[cursor].text not in KEYWORDS:
            cursor += 1
        if cursor < len(tokens) and tokens[cursor].kind == OP and tokens[cursor].text == "(":
            depth = 0
            cursor += 1
            while cursor < len(tokens):
                current = tokens[cursor]
                if current.kind == OP and current.text == "(":
                    depth += 1
                elif current.kind == OP and current.text == ")":
                    if depth == 0:
                        break
                    depth -= 1
                elif current.kind == NAME and depth == 0:
                    declared.add(current.text)
                cursor += 1

    # Generic type parameter lists: `function f<T>(...)` and `type X<T> = ...`.
    for index, token in enumerate(tokens):
        if token.kind == OP and token.text == "<":
            prev = tokens[index - 1] if index > 0 else None
            if prev and prev.kind == NAME and prev.text not in KEYWORDS:
                cursor = index + 1
                while cursor < len(tokens) and tokens[cursor].text != ">":
                    if tokens[cursor].kind == NAME:
                        declared.add(tokens[cursor].text)
                    cursor += 1

    # Exported type aliases: `export type Hero = {...}` declares Hero.
    for index, token in enumerate(tokens):
        nxt = tokens[index + 1] if index + 1 < len(tokens) else None
        after = tokens[index + 2] if index + 2 < len(tokens) else None
        if (
            token.kind == NAME
            and token.text in ("type", "export")
            and (
                (nxt and nxt.kind == NAME and nxt.text == "type" and after and after.kind == NAME)
                or (token.text == "export" and nxt and nxt.kind == NAME and nxt.text == "type")
            )
        ):
            if token.text == "type" and nxt and nxt.kind == NAME:
                declared.add(nxt.text)
            elif after and after.kind == NAME:
                declared.add(after.text)

    reported: set[str] = set()
    for index, token in enumerate(tokens):
        if token.kind != NAME:
            continue
        name = token.text
        if name in KEYWORDS or name in SAFE_GLOBALS or name in TYPE_NAMES:
            continue
        if name in declared or name in reported:
            continue

        prev = tokens[index - 1] if index > 0 else None
        if prev and prev.kind == OP and prev.text in (".", ":", "::"):
            continue

        nxt = tokens[index + 1] if index + 1 < len(tokens) else None
        # Assignment to a global, or a field/table key followed by `=` or `:`.
        if nxt and nxt.kind == OP and nxt.text in ("=", ",", ":"):
            continue
        # A name directly followed by `:` is a parameter, a table key, or a type
        # annotation being declared (`local f = function(a: T)`) -- never a
        # global read. Reporting these produces far more noise than signal.
        if nxt and nxt.kind == OP and nxt.text == ":":
            continue
        # Unmasked leftovers of a type list, e.g. the `number` in
        # `: (number, number)`. A name followed by `?`, `)`, `>` or `|` in a
        # position that follows a type separator is a type, not a value.
        if nxt and nxt.kind == OP and nxt.text in ("?", "|", ">"):
            continue
        if (
            nxt
            and nxt.kind == OP
            and nxt.text in (")", "}")
            and prev
            and prev.kind == OP
            and prev.text in (":", "?", "|", "(", "{", ",")
        ):
            continue
        reported.add(name)

        if name in FORBIDDEN_GLOBALS:
            report.findings.append(
                Finding(token.line, "error", f"'{name}' is unavailable: {FORBIDDEN_GLOBALS[name]}")
            )
        else:
            report.findings.append(
                Finding(token.line, "warn", f"'{name}' is never declared locally; global?")
            )


def check_local_forward_use(tokens: list[Token], report: FileReport) -> None:
    """Error when `local function f` is invoked above its own definition.

    In Luau this is a runtime nil-index, not a compile error, which makes it easy
    to introduce by moving code around. Parameter names and the definition itself
    are excluded so only real call sites are reported.
    """
    defined: dict[str, int] = {}
    definition_offsets: dict[str, int] = {}
    for index, token in enumerate(tokens):
        if token.kind == NAME and token.text == "local":
            nxt = tokens[index + 1] if index + 1 < len(tokens) else None
            after = tokens[index + 2] if index + 2 < len(tokens) else None
            if nxt and nxt.text == "function" and after and after.kind == NAME:
                defined.setdefault(after.text, after.line)
                definition_offsets[after.text] = index + 2

    # Forward declarations make early use legal: `local f` before the definition.
    forward_ok: set[str] = set()
    for index, token in enumerate(tokens):
        if token.kind == NAME and token.text == "local":
            nxt = tokens[index + 1] if index + 1 < len(tokens) else None
            if nxt and nxt.kind == NAME and nxt.text in defined:
                nxt2 = tokens[index + 2] if index + 2 < len(tokens) else None
                if not (nxt2 and nxt2.kind == NAME and nxt2.text == "function"):
                    forward_ok.add(nxt.text)

    # Parameter positions, so `local function f(cb)` does not count cb as a call.
    parameter_offsets: set[int] = set()
    for index, token in enumerate(tokens):
        if token.kind == NAME and token.text == "function":
            cursor = index + 1
            if cursor < len(tokens) and tokens[cursor].kind == NAME and tokens[cursor].text not in KEYWORDS:
                cursor += 1
            if cursor < len(tokens) and tokens[cursor].kind == OP and tokens[cursor].text == "(":
                depth = 0
                cursor += 1
                while cursor < len(tokens):
                    current = tokens[cursor]
                    if current.kind == OP and current.text == "(":
                        depth += 1
                    elif current.kind == OP and current.text == ")":
                        if depth == 0:
                            break
                        depth -= 1
                    elif current.kind == NAME and depth == 0:
                        parameter_offsets.add(cursor)
                    cursor += 1

    for name, definition_line in defined.items():
        if name in forward_ok:
            continue
        definition_offset = definition_offsets[name]
        for index, token in enumerate(tokens):
            if index >= definition_offset:
                break
            if token.kind != NAME or token.text != name or index in parameter_offsets:
                continue
            prev = tokens[index - 1] if index > 0 else None
            if prev and prev.kind == OP and prev.text in (".", ":", "::"):
                continue
            nxt = tokens[index + 1] if index + 1 < len(tokens) else None
            if not (nxt and nxt.kind == OP and nxt.text in ("(", "{", "<")):
                continue
            report.findings.append(
                Finding(
                    token.line,
                    "error",
                    f"'{name}' used on line {token.line} before its `local function` definition "
                    f"on line {definition_line}",
                )
            )
            break


def check_markers(tokens: list[Token], text: str, report: FileReport) -> None:
    for marker in ("TODO", "FIXME", "XXX"):
        for match in re.finditer(r"\b" + marker + r"\b", text):
            report.findings.append(
                Finding(text.count("\n", 0, match.start()) + 1, "warn", f"{marker} left in source")
            )


# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------


def verify(path: Path) -> FileReport:
    report = FileReport(path)
    text = path.read_text(encoding="utf-8")
    tokens = tokenize(text)

    masked = mask_type_annotations(tokens)
    structural = [t for i, t in enumerate(tokens) if i not in masked]

    check_brackets(structural, report)
    inline = inline_if_lines(text, structural)
    check_blocks(structural, report, inline)
    check_globals(tokens, report)
    check_local_forward_use(structural, report)
    if "return" not in text:
        report.findings.append(Finding(1, "warn", "no return statement: is this a module?"))
    check_markers(structural, text, report)

    report.findings.sort(key=lambda f: (f.severity != "error", f.line))
    return report


def main(argv: list[str]) -> int:
    root = Path(argv[1]) if len(argv) > 1 else Path(".")
    files = sorted(root.rglob("*.luau"))
    if not files:
        print(f"no .luau files under {root}")
        return 1

    total_errors = 0
    total_warnings = 0
    print(f"verifying {len(files)} Luau file(s) under {root}\n")

    for path in files:
        report = verify(path)
        total_errors += len(report.errors)
        total_warnings += len(report.warnings)
        rel = path.relative_to(root)
        status = "FAIL" if report.errors else ("warn" if report.warnings else " ok ")
        print(f"[{status}] {rel}")
        for finding in report.findings:
            print(f"          {finding.line}: {finding.severity}: {finding.message}")

    print()
    print("=" * 64)
    print(f"files: {len(files)}   errors: {total_errors}   warnings: {total_warnings}")
    return 1 if total_errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
