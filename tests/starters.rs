//! The starter templates (ADR 17, section 8) are shared with the client in `js/starters.json`.
//! Each one must parse with the right variable at the slider's min, default and max, and be
//! finite at the start point. For `r = f(θ)` that is the shooter's map angle `θ₀` in `[0, 2π)`
//! (ADR 20), so it is checked at several of them.

use std::f64::consts::{FRAC_PI_2, PI};

use graph_fight::formula::Formula;
use serde_json::{Map, Value};

/// Replaces every slider token with the `pick` value (`min`, `value` or `max`), negatives in
/// parentheses. This uses `f64`'s `Display`, not `formatValue` from `js/library.ts`; the text is
/// the same for the starters' values. Tokens are a letter followed by letters or digits.
fn substitute(src: &str, sliders: &Map<String, Value>, pick: &str) -> String {
    let mut out = String::new();
    let mut chars = src.chars().peekable();
    while let Some(c) = chars.next() {
        if !c.is_alphabetic() {
            out.push(c);
            continue;
        }
        let mut name = c.to_string();
        while let Some(n) = chars.next_if(|n| n.is_alphanumeric()) {
            name.push(n);
        }
        match sliders.get(&name) {
            Some(s) => {
                let v = s[pick].as_f64().expect("slider limits are numbers");
                out.push_str(&if v < 0.0 {
                    format!("({v})")
                } else {
                    v.to_string()
                });
            }
            None => out.push_str(&name),
        }
    }
    out
}

#[test]
fn starters_parse_and_are_finite_at_the_start() {
    let starters: Vec<Value> = serde_json::from_str(include_str!("../js/starters.json"))
        .expect("starters.json is a JSON array");
    assert!(!starters.is_empty());
    for starter in &starters {
        let name = starter["name"].as_str().expect("name");
        let vars: [&str; 2] = match (starter["field"].as_str(), starter["mode"].as_str()) {
            (Some("xy"), Some("explicit")) => ["x", "x"],
            (Some("disc"), Some("explicit")) => ["θ", "θ"],
            (Some("xy" | "disc"), Some("parametric")) => ["t", "t"],
            other => panic!("{name}: unknown field and mode {other:?}"),
        };
        let sliders = starter["sliders"].as_object().expect("sliders");
        let exprs = starter["exprs"].as_array().expect("exprs");
        for pick in ["min", "value", "max"] {
            for (expr, var) in exprs.iter().zip(vars) {
                let src = substitute(expr.as_str().expect("expr"), sliders, pick);
                let formula = Formula::parse(&src, var)
                    .unwrap_or_else(|e| panic!("{name} at {pick}: '{src}' does not parse: {e}"));
                let starts: &[f64] = if var == "θ" {
                    &[0.0, FRAC_PI_2, PI, 3.0 * FRAC_PI_2, 6.2]
                } else {
                    &[0.0]
                };
                for &start in starts {
                    let y = formula.eval(start);
                    assert!(y.is_finite(), "{name} at {pick}: '{src}' is {y} at {start}");
                }
            }
        }
    }
}
