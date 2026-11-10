//! Bot players (ADR 21): a search over the starter templates, simulated on a copy of the game.
//!
//! A bot draws from its own generator, seeded from the operating system. The game's seed never
//! reaches it, and the search fires only on the bot's copy, so the live game and every peer stay
//! in lockstep (ADR 2). The host sends the chosen formulas like a human's.

// tsify 0.5 deprecates `into_wasm_abi` (it panics on a failed conversion, and unwinding
// leaks). `BotShot` only serializes, so the conversion cannot fail.
#![expect(deprecated)]

use std::collections::BTreeMap;

use rand::{RngExt, rngs::SmallRng};
use rand_distr::StandardNormal;
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::prelude::*;

use crate::game::{Field, FireError, Frame, Game, Shot};

/// Score of each enemy player a shot kills.
const KILL: f64 = 100.;
/// Score of each teammate a shot kills: worse than any miss, which is under 45 on both fields.
const TEAM_KILL: f64 = -150.;
/// The refine phase improves this many distinct (template, direction) pairs.
const SEEDS: usize = 3;
/// Refine step, as a fraction of a slider's span: geometric from the first try toward the last.
const STEP_FIRST: f64 = 0.15;
const STEP_LAST: f64 = 0.003;

/// How strong a bot plays (ADR 21).
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    Easy,
    Medium,
    Hard,
}

impl Level {
    /// Candidates simulated per shot, and the aim noise as a fraction of each slider's span.
    fn search(self) -> (usize, f64) {
        match self {
            Level::Easy => (20, 0.03),
            Level::Medium => (100, 0.004),
            Level::Hard => (400, 0.0003),
        }
    }
}

/// A bot's shot: one formula, or two for a parametric one, and the disc direction (`false` on XY).
#[derive(Clone, Debug, PartialEq, Serialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct BotShot {
    pub exprs: Vec<String>,
    pub cw: bool,
}

/// A starter in `js/starters.json`; the keys the bot does not use are ignored.
#[derive(Deserialize)]
struct Starter {
    field: String,
    exprs: Vec<String>,
    sliders: BTreeMap<String, Limits>,
}

#[derive(Deserialize)]
struct Limits {
    min: f64,
    max: f64,
}

/// A starter as the bot fires it: slider names with their limits, in a fixed order.
struct Template {
    exprs: Vec<String>,
    sliders: Vec<(String, Limits)>,
}

/// The starter templates for the game's field. On the disc in the player frame the parametric
/// starters' radial formula is negated: `r = −t` leaves the disc at once in that frame.
fn templates(game: &Game) -> Vec<Template> {
    let starters: Vec<Starter> = serde_json::from_str(include_str!("../js/starters.json"))
        .expect("js/starters.json is a valid starter list (tests/starters.rs)");
    let (field, negate) = match game.arena().field() {
        Field::Xy => ("xy", false),
        Field::Disc => ("disc", game.frame() == Frame::Player),
    };
    starters
        .into_iter()
        .filter(|s| s.field == field)
        .map(|s| {
            let mut exprs = s.exprs;
            if negate && exprs.len() == 2 {
                exprs[0] = format!("-({})", exprs[0]);
            }
            Template {
                exprs,
                sliders: s.sliders.into_iter().collect(),
            }
        })
        .collect()
}

/// `formatValue(v, 6)` from `js/library.ts`: `toFixed(6)` without trailing zeros, `-0` as `0`,
/// negatives in parentheses.
fn format_value(v: f64) -> String {
    let a = v.abs();
    let mut text = format!("{a:.6}");
    // `toFixed` rounds an exact tie away from zero, Rust's formatting to even. `{:.60}` is the
    // exact expansion of any value that can tie at the 7th decimal.
    let exact = format!("{a:.60}");
    if exact
        .split_once('.')
        .is_some_and(|(_, f)| f[6..].trim_end_matches('0') == "5")
    {
        text = format!("{:.6}", a.next_up());
    }
    let text = text.trim_end_matches('0').trim_end_matches('.');
    if v < 0. && text != "0" {
        format!("(-{text})")
    } else {
        text.to_string()
    }
}

/// Replaces each slider name in `expr` with its value, the text `substitute` in `js/library.ts`
/// gives for a slider with 6 decimals. Names are a letter followed by letters or digits.
fn substitute(expr: &str, sliders: &[(String, Limits)], values: &[f64]) -> String {
    let mut out = String::new();
    let mut chars = expr.chars().peekable();
    while let Some(c) = chars.next() {
        if !c.is_alphabetic() {
            out.push(c);
            continue;
        }
        let mut name = c.to_string();
        while let Some(n) = chars.next_if(|n| n.is_alphanumeric()) {
            name.push(n);
        }
        match sliders.iter().position(|(s, _)| *s == name) {
            Some(i) => out.push_str(&format_value(values[i])),
            None => out.push_str(&name),
        }
    }
    out
}

/// Fires `exprs` (one formula, or two for a parametric shot) on `game`.
fn fire(game: &mut Game, exprs: &[String], cw: bool) -> Result<Shot, FireError> {
    match exprs {
        [a, b] => game.fire_param(a, b, cw),
        _ => game.fire(&exprs[0], cw),
    }
}

/// Score of firing `exprs` on a clone of `game`: 100 per enemy killed, −150 per teammate killed,
/// minus the closest miss (the gap from the shot to a surviving enemy's edge, at least 0).
/// A shot the engine rejects scores −∞.
fn score(game: &Game, exprs: &[String], cw: bool) -> f64 {
    let mut sim = game.clone();
    let Ok(shot) = fire(&mut sim, exprs, cw) else {
        return f64::NEG_INFINITY;
    };
    let me = game.get_current_team_idx();
    let mut total = 0.;
    let mut miss = f64::INFINITY;
    let teams = game.arena().get_teams().iter().zip(sim.arena().get_teams());
    for (i, (before, after)) in teams.enumerate() {
        for (p, q) in before.players().iter().zip(after.players()) {
            if !p.alive() {
                continue;
            }
            if !q.alive() {
                total += if i == me { TEAM_KILL } else { KILL };
            } else if i != me {
                let near = shot
                    .points
                    .iter()
                    .map(|pt| pt.distance_to(p.shape().pos()))
                    .fold(f64::INFINITY, f64::min);
                miss = miss.min(near - p.shape().radius());
            }
        }
    }
    total - if miss.is_finite() { miss.max(0.) } else { 0. }
}

/// `values` with Gaussian noise of `sigma` times each slider's span, kept inside the limits.
fn jitter(
    rng: &mut SmallRng,
    values: &[f64],
    sliders: &[(String, Limits)],
    sigma: f64,
) -> Vec<f64> {
    values
        .iter()
        .zip(sliders)
        .map(|(v, (_, s))| {
            let noise: f64 = rng.sample(StandardNormal);
            (v + noise * sigma * (s.max - s.min)).clamp(s.min, s.max)
        })
        .collect()
}

struct Candidate {
    template: usize,
    values: Vec<f64>,
    cw: bool,
    score: f64,
}

/// One bot turn's search (ADR 21). It owns a copy of the game and its own random generator.
#[wasm_bindgen]
pub struct Bot {
    rng: SmallRng,
    game: Game,
    templates: Vec<Template>,
    /// Candidates to simulate, and the aim noise.
    candidates: usize,
    noise: f64,
    /// Candidates simulated so far.
    tried: usize,
    /// The random phase's candidates; from the refine phase on, the best of each seed pair.
    pool: Vec<Candidate>,
}

#[wasm_bindgen]
impl Bot {
    /// Starts a search for the current team of `game`, at `level`. The bot copies the game and
    /// seeds its generator from the operating system, never from the game.
    #[wasm_bindgen(constructor)]
    pub fn new(game: &Game, level: Level) -> Bot {
        Bot::with_rng(game, level, rand::make_rng())
    }

    /// Simulates up to `budget` more candidates. Returns the shot once all of the level's
    /// candidates are done, `undefined` before that; call it again after yielding to the page.
    pub fn think(&mut self, budget: usize) -> Option<BotShot> {
        for _ in 0..budget {
            if self.tried == self.candidates {
                break;
            }
            self.step();
        }
        (self.tried == self.candidates).then(|| self.aim())
    }
}

impl Bot {
    fn with_rng(game: &Game, level: Level, rng: SmallRng) -> Bot {
        let (candidates, noise) = level.search();
        Bot {
            rng,
            game: game.clone(),
            templates: templates(game),
            candidates,
            noise,
            tried: 0,
            pool: Vec::new(),
        }
    }

    /// A bot with a fixed seed, for reproducible tests only.
    #[cfg(test)]
    fn with_test_seed(game: &Game, level: Level, seed: u64) -> Bot {
        Bot::with_rng(game, level, rand::SeedableRng::seed_from_u64(seed))
    }

    fn exprs(&self, template: usize, values: &[f64]) -> Vec<String> {
        let t = &self.templates[template];
        t.exprs
            .iter()
            .map(|e| substitute(e, &t.sliders, values))
            .collect()
    }

    /// The first half of the candidates draw a template, slider values and direction uniformly.
    /// The second half refines the best `SEEDS` distinct (template, direction) pairs, round-robin:
    /// each try moves every slider by a Gaussian step and is kept if it scores higher.
    fn step(&mut self) {
        let random = self.candidates.div_ceil(2);
        if self.tried < random {
            let template = self.rng.random_range(0..self.templates.len());
            let values = self.templates[template]
                .sliders
                .iter()
                .map(|(_, s)| s.min + self.rng.random::<f64>() * (s.max - s.min))
                .collect();
            let cw = self.game.arena().field() == Field::Disc && self.rng.random();
            self.pool.push(self.candidate(template, values, cw));
        } else {
            if self.tried == random {
                self.pick_seeds();
            }
            let j = self.tried - random;
            let i = j % self.pool.len();
            let (template, cw) = (self.pool[i].template, self.pool[i].cw);
            let sliders = &self.templates[template].sliders;
            if !sliders.is_empty() {
                let progress = j as f64 / (self.candidates - random) as f64;
                let sigma = STEP_FIRST * (STEP_LAST / STEP_FIRST).powf(progress);
                let values = jitter(&mut self.rng, &self.pool[i].values, sliders, sigma);
                let next = self.candidate(template, values, cw);
                if next.score > self.pool[i].score {
                    self.pool[i] = next;
                }
            }
        }
        self.tried += 1;
    }

    fn candidate(&self, template: usize, values: Vec<f64>, cw: bool) -> Candidate {
        let score = score(&self.game, &self.exprs(template, &values), cw);
        Candidate {
            template,
            values,
            cw,
            score,
        }
    }

    /// Keeps the best candidate of each of the `SEEDS` best (template, direction) pairs.
    fn pick_seeds(&mut self) {
        self.pool.sort_by(|a, b| b.score.total_cmp(&a.score));
        let mut seeds: Vec<Candidate> = Vec::new();
        for c in self.pool.drain(..) {
            if seeds.len() < SEEDS
                && !seeds
                    .iter()
                    .any(|s| (s.template, s.cw) == (c.template, c.cw))
            {
                seeds.push(c);
            }
        }
        self.pool = seeds;
    }

    /// The best candidate's formulas with aim noise on its sliders. If the noisy formulas fail,
    /// the clean ones are fired.
    fn aim(&mut self) -> BotShot {
        let best = self
            .pool
            .iter()
            .reduce(|a, b| if b.score > a.score { b } else { a })
            .expect("the search ends with at least one candidate");
        let sliders = &self.templates[best.template].sliders;
        let noisy = jitter(&mut self.rng, &best.values, sliders, self.noise);
        let mut exprs = self.exprs(best.template, &noisy);
        if fire(&mut self.game.clone(), &exprs, best.cw).is_err() {
            exprs = self.exprs(best.template, &best.values);
        }
        BotShot { exprs, cw: best.cw }
    }
}

#[cfg(test)]
mod tests {
    use rand::SeedableRng;

    use super::*;
    use crate::formula::{Formula, MAX_LEN};

    /// A game with the client's arena for `field` (ADR 15): XY with 2 teams, the disc with 4.
    fn game(field: Field, frame: Frame, seed: u64) -> Game {
        let (extent, obstacles, max_size, teams) = match field {
            Field::Xy => ((20., 10.), 30, 2., 2),
            Field::Disc => ((10., 10.), 20, 1.5, 4),
        };
        Game::new(
            field,
            frame,
            extent.0,
            extent.1,
            obstacles,
            0.2,
            max_size,
            &vec![3; teams],
            0.3,
            seed,
        )
        .unwrap()
    }

    const BOARDS: [(Field, Frame); 4] = [
        (Field::Xy, Frame::Map),
        (Field::Xy, Frame::Player),
        (Field::Disc, Frame::Map),
        (Field::Disc, Frame::Player),
    ];

    fn run(bot: &mut Bot) -> BotShot {
        loop {
            if let Some(shot) = bot.think(16) {
                return shot;
            }
        }
    }

    #[test]
    fn values_are_written_like_library_substitute() {
        // Expected texts from `formatValue(v, 6)` and `substitute` in js/library.ts
        for (v, text) in [
            (0.0078125, "0.007813"),
            (-0.0078125, "(-0.007813)"),
            (1e-7, "0"),
            (-1e-7, "0"),
            (-0., "0"),
            (2.5, "2.5"),
            (-3.25, "(-3.25)"),
            (1. / 3., "0.333333"),
            (-2. / 3., "(-0.666667)"),
            (20., "20"),
            (0.1234565, "0.123456"),
            (1.0000005, "1.000001"),
            (-0.0005, "(-0.0005)"),
        ] {
            assert_eq!(format_value(v), text, "{v}");
        }
        let limits = |names: &[&str]| -> Vec<(String, Limits)> {
            names
                .iter()
                .map(|n| (n.to_string(), Limits { min: -1., max: 1. }))
                .collect()
        };
        assert_eq!(
            substitute(
                "a*(x - b)^2",
                &limits(&["a", "b"]),
                &[-0.0213456789, 12.3456785]
            ),
            "(-0.021346)*(x - 12.345678)^2"
        );
        assert_eq!(
            substitute("d*(t - a*sin(t))", &limits(&["a", "d"]), &[2.9999999, -1.]),
            "(-1)*(t - 3*sin(t))"
        );
        assert_eq!(
            substitute("a*sin(b*θ)", &limits(&["a", "b"]), &[4.25, 7.0000004]),
            "4.25*sin(7*θ)"
        );
    }

    #[test]
    fn every_template_substitutes_to_a_formula_the_engine_parses() {
        let mut rng = SmallRng::seed_from_u64(1);
        let mut checked = 0;
        for (field, frame) in BOARDS {
            let game = game(field, frame, 1);
            let bot = Bot::with_test_seed(&game, Level::Hard, 1);
            assert!(!bot.templates.is_empty());
            for (i, t) in bot.templates.iter().enumerate() {
                let vars: &[&str] = match (field, t.exprs.len()) {
                    (_, 2) => &["t", "t"],
                    (Field::Xy, _) => &["x"],
                    (Field::Disc, _) => &["θ"],
                };
                let random = t
                    .sliders
                    .iter()
                    .map(|(_, s)| rng.random_range(s.min..=s.max))
                    .collect();
                let picks: [Vec<f64>; 3] = [
                    t.sliders.iter().map(|(_, s)| s.min).collect(),
                    t.sliders.iter().map(|(_, s)| s.max).collect(),
                    random,
                ];
                for values in picks {
                    let exprs = bot.exprs(i, &values);
                    assert_eq!(exprs.len(), vars.len());
                    for (src, var) in exprs.iter().zip(vars) {
                        assert!(src.chars().count() <= MAX_LEN, "{src}");
                        assert!(Formula::parse(src, var).is_ok(), "{src}");
                    }
                    assert!(score(&game, &exprs, false).is_finite(), "{exprs:?}");
                    checked += 1;
                }
            }
        }
        // 6 XY and 4 disc starters, on two frames each, at three picks
        assert_eq!(checked, 60);
    }

    #[test]
    fn player_frame_disc_negates_the_radial_formula() {
        let exprs = |frame| -> Vec<Vec<String>> {
            let bot = Bot::with_test_seed(&game(Field::Disc, frame, 1), Level::Easy, 1);
            bot.templates.into_iter().map(|t| t.exprs).collect()
        };
        let (map, player) = (exprs(Frame::Map), exprs(Frame::Player));
        assert!(map.iter().any(|e| e[..] == ["-t", "a*t"]));
        assert!(player.iter().any(|e| e[..] == ["-(-t)", "a*t"]));
        assert!(player.iter().any(|e| e[..] == ["a*θ"]));
        assert!(!player.iter().flatten().any(|e| e == "-t"));
    }

    #[test]
    fn think_runs_in_chunks_to_the_same_shot() {
        let game = game(Field::Disc, Frame::Map, 3);
        let mut chunked = Bot::with_test_seed(&game, Level::Easy, 9);
        // Easy simulates 20 candidates
        assert_eq!(chunked.think(7), None);
        assert_eq!(chunked.think(7), None);
        let shot = chunked.think(7).unwrap();
        assert_eq!(
            Bot::with_test_seed(&game, Level::Easy, 9).think(20),
            Some(shot)
        );
    }

    #[test]
    fn a_search_leaves_the_game_unchanged() {
        for (field, frame) in BOARDS {
            let live = game(field, frame, 5);
            let untouched = live.clone();
            let shot = run(&mut Bot::with_test_seed(&live, Level::Hard, 5));
            assert!(live.js_arena() == untouched.js_arena());
            assert_eq!(
                live.get_current_team_idx(),
                untouched.get_current_team_idx()
            );
            assert_eq!(live.winner(), untouched.winner());

            // The next real shot has the same outcome as without the search
            let (mut a, mut b) = (live, untouched);
            assert_eq!(
                fire(&mut a, &shot.exprs, shot.cw),
                fire(&mut b, &shot.exprs, shot.cw)
            );
            assert!(a.js_arena() == b.js_arena());
            assert_eq!(a.get_current_team_idx(), b.get_current_team_idx());
            assert!(
                field == Field::Disc || !shot.cw,
                "XY shots go counter-clockwise"
            );
        }
    }

    #[test]
    fn a_hard_bot_usually_kills_with_its_first_shot() {
        let mut hits = 0;
        for seed in 0..10 {
            let game = game(Field::Disc, Frame::Map, seed);
            let shot = run(&mut Bot::with_test_seed(&game, Level::Hard, seed));
            hits += (score(&game, &shot.exprs, shot.cw) >= KILL / 2.) as usize;
        }
        assert!(hits >= 7, "{hits} of 10");
    }

    /// Measures the levels table in ADR 21: `cargo test --release calibrate -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn calibrate() {
        const SEEDS: u64 = 60;
        for level in [Level::Easy, Level::Medium, Level::Hard] {
            for (field, frame) in BOARDS {
                let (mut found, mut hit) = (0, 0);
                for seed in 0..SEEDS {
                    let game = game(field, frame, seed + 100);
                    let mut bot = Bot::with_test_seed(&game, level, seed);
                    let shot = run(&mut bot);
                    let best = bot
                        .pool
                        .iter()
                        .map(|c| c.score)
                        .fold(f64::NEG_INFINITY, f64::max);
                    found += (best >= KILL / 2.) as u64;
                    hit += (score(&game, &shot.exprs, shot.cw) >= KILL / 2.) as u64;
                }
                println!(
                    "{level:?} {field:?} {frame:?}: found {}%, hit {}%",
                    100 * found / SEEDS,
                    100 * hit / SEEDS
                );
            }
        }
    }
}
