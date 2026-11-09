# 3. Replace meval with a small hand-written formula parser

Status: Accepted (2026-11-09)

## Context

`meval 0.2.0` (last release 2018) is unmaintained and depends on `nom 1.2.4`. On rustc 1.99,
`cargo check` already reports that nom contains "code that will be rejected by a future version
of Rust". The engine needs variables named `x`, `t`, and `θ`/`theta`, and must evaluate
identically on every peer.

Options considered: keep meval (works today, but it will eventually stop compiling); switch to
a maintained crate such as `exmex` (a new dependency with its own syntax rules); or write a
recursive-descent parser (about 150 lines with tests, no dependency).

## Decision

Write `src/formula.rs`: a recursive-descent parser over `+ - * / ^`, unary minus, parentheses,
decimal numbers, constants `pi` and `e`, one bound variable per expression, and the functions
`sin cos tan asin acos atan sinh cosh tanh sqrt abs exp ln log10 floor ceil`. It returns a
typed `ParseError` and builds an expression tree that is evaluated with `f64` std methods.
`^` is right-associative and uses `powf`. There is no implicit multiplication (`2x` is an
error). Remove `meval` from `Cargo.toml`.

## Consequences

- One fewer dependency, no future-incompatibility warning, and full control over variable names
  and error messages.
- We own the parser's correctness, so its unit tests (precedence, associativity, unary minus,
  functions, errors) are required.
