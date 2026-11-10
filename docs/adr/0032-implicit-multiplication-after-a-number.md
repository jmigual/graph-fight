# 32. Implicit multiplication after a number

Status: Accepted (2026-11-10). Amends 0003 (the parser) and 0017 (slider letters).

## Context

ADR 3 made every product explicit, so `2x` was an error. Players coming from Desmos or a maths
class type `2x`, `2θ`, `2sin(x)` and `2(x+1)`, and the error costs a turn for no gain.

## Decision

- A number literal directly followed by a name (the variable, `theta`/`th`, `pi`/`π`, `e`, any
  function) or `(` is multiplied, as if `*` were written. It is handled in the `*` and `/` loop of
  `src/formula.rs`, so it has the precedence of `*` and groups from the left: `2x^2` is `2*(x^2)`,
  `-2x` is `(-2)*x` (the same value as `-(2*x)`), `1/2x` is `(1/2)*x`, `2^3x` is `(2^3)*x`.
- It applies only straight after a number literal. `x y`, `x(1)`, `(x)(y)`, `pi x`, `sin(x)x`
  and `2 3` keep their errors; `x2` is still one name (`UnknownName`).
- Whitespace is allowed (`2 x` is `2*x`), because the parser already ignores spaces everywhere.
- There is still no scientific notation: `2e` is `2*e`, and `2e3` is the unknown name `e3`.
- Slider letters (ADR 17) act like names. `2a` is no longer refused on save: it is a product, as
  `2x` is. `substitute` puts a value in parentheses when it follows a whole number (`2a` with
  `a = 1.5` becomes `2(1.5)`, not `21.5`; the digits of a name such as `k2` or `log10` do not
  count) or precedes a name or `(` (`a(x+1)` becomes `(1.5)(x+1)`, an error at every value, as
  `x(1)` is). Spaces may sit in between. A negative value already has its parentheses. A slider
  right before a `.` (`a.5`) is still refused.
- Bots (ADR 21) write the same text: `substitute` in `src/bot.rs` has the same two rules, and a
  test keeps its output equal to `tests/library.test.mjs`.

## Consequences

- `2y` is now `UnknownName("y")` instead of `UnexpectedToken('y')`.
- The in-app help (ADR 26) describes it in "Products".
- `2^3x` reads as `(2^3)*x`, not `2^(3x)`; use parentheses for the other. Likewise `e^2x` is
  `e^2*x` and `x^2x` is `x^3`.
