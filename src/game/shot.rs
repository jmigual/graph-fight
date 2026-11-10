//! Shot sampling and collisions (ADR 4, 5, 14 and 20).

// tsify 0.5 deprecates `into_wasm_abi` (it panics on a failed conversion, and unwinding
// leaks). These types only serialize, so the conversion cannot fail; `Ts<T>` would change the
// signatures the Rust tests call.
#![expect(deprecated)]

use std::{f64::consts::TAU, fmt};

use serde::Serialize;
use tsify::Tsify;

use super::{Arena, Field, Frame};
use crate::{
    formula::{Formula, ParseError},
    geometry::Point,
};

/// The sampled world trajectory of a shot, ending where the shot stopped.
#[derive(Clone, Debug, PartialEq, Serialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct Shot {
    pub points: Vec<Point>,
}

/// Why a shot could not be fired. Nothing changes in the game when this happens.
#[derive(Clone, Debug, PartialEq)]
pub enum FireError {
    /// A formula failed to parse.
    Parse(ParseError),
    /// The curve is not a finite point at the start of its range (for example `1/x`), so it
    /// cannot be anchored at the shooter.
    UndefinedAtShooter,
}

impl From<ParseError> for FireError {
    fn from(e: ParseError) -> FireError {
        FireError::Parse(e)
    }
}

impl fmt::Display for FireError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FireError::Parse(e) => e.fmt(f),
            FireError::UndefinedAtShooter => f.write_str("The formula is undefined at the shooter"),
        }
    }
}

/// Fixed base step is the parameter range divided by this.
const BASE_STEPS: f64 = 4000.;
/// Consecutive points are at most this far apart.
const MAX_GAP: f64 = 0.05;
/// A step below `range * MIN_STEP` is a discontinuity.
const MIN_STEP: f64 = 1e-9;
/// Evaluations of the curve before the shot is cut off.
const MAX_EVALS: usize = 200_000;

/// The point at polar coordinates `(r, theta)`. A negative `r` lies on the opposite side of the
/// centre (standard polar coordinates).
fn polar(r: f64, theta: f64) -> Point {
    Point::new(r * theta.cos(), r * theta.sin())
}

/// The shooter's world position.
fn position(arena: &Arena, shooter: (usize, usize)) -> Point {
    arena.get_teams()[shooter.0].players()[shooter.1]
        .shape()
        .pos()
        .clone()
}

/// The shooter's map polar coordinates `(r, θ₀)`, with `θ₀` in `[0, 2π)` (ADR 20).
fn polar_position(arena: &Arena, shooter: (usize, usize)) -> (f64, f64) {
    let p = position(arena, shooter);
    (p.x.hypot(p.y), p.y.atan2(p.x).rem_euclid(TAU))
}

/// Fires `y = f(x)` on the XY field or `r = f(θ)` on the disc, from `shooter` (team, player).
/// `Frame::Map` (ADR 20): map coordinates offset to pass through the shooter. On XY `x` sweeps
/// from the shooter's `x_p` toward the other half and `y = f(x) − f(x_p) + y_p`. On the disc `θ`
/// sweeps one turn from the shooter's map angle `θ₀`, counter-clockwise or, with `clockwise`,
/// clockwise, and `r = f(θ) − f(θ₀) + r_p`.
/// `Frame::Player` (ADR 4, 5, 14): the shooter's local frame, facing the centre; `clockwise`
/// mirrors a disc shot across the shooter-to-centre axis.
/// XY ignores `clockwise` in both frames.
pub fn explicit(
    arena: &mut Arena,
    shooter: (usize, usize),
    f: &Formula,
    frame: Frame,
    clockwise: bool,
) -> Result<Shot, FireError> {
    let range = match arena.field() {
        Field::Xy => 2. * arena.x_max(),
        Field::Disc => TAU,
    };
    match (arena.field(), frame) {
        (Field::Xy, Frame::Map) => {
            let x0 = position(arena, shooter).x;
            let dir = if x0 > 0. { -1. } else { 1. };
            trace(arena, shooter, range, frame, clockwise, |s| {
                let x = x0 + dir * s;
                Point::new(x, f.eval(x))
            })
        }
        (Field::Disc, Frame::Map) => {
            let (r0, theta0) = polar_position(arena, shooter);
            let (f0, dir) = (f.eval(theta0), if clockwise { -1. } else { 1. });
            trace(arena, shooter, range, frame, clockwise, |s| {
                let theta = theta0 + dir * s;
                polar(f.eval(theta) - f0 + r0, theta)
            })
        }
        (Field::Xy, Frame::Player) => trace(arena, shooter, range, frame, clockwise, |x| {
            Point::new(x, f.eval(x))
        }),
        (Field::Disc, Frame::Player) => trace(arena, shooter, range, frame, clockwise, |theta| {
            polar(f.eval(theta), theta)
        }),
    }
}

/// Fires `x(t), y(t)` on the XY field or `r(t), θ(t)` on the disc, from `shooter` (team, player).
/// `Frame::Map` (ADR 20): on XY the point is `(x(t) − x(0), y(t) − y(0))` from the shooter in map
/// coordinates; on the disc it is at radius `r(t) − r(0) + r_p` and angle `θ₀ ± (θ(t) − θ(0))`,
/// minus when `clockwise`. `Frame::Player`: the shooter's local frame as in `explicit`.
/// XY ignores `clockwise` in both frames.
pub fn parametric(
    arena: &mut Arena,
    shooter: (usize, usize),
    a: &Formula,
    b: &Formula,
    frame: Frame,
    clockwise: bool,
) -> Result<Shot, FireError> {
    let range = match arena.field() {
        Field::Xy => 2. * arena.x_max(),
        Field::Disc => 2. * arena.y_max(),
    };
    match (arena.field(), frame) {
        (Field::Xy, _) => trace(arena, shooter, range, frame, clockwise, |t| {
            Point::new(a.eval(t), b.eval(t))
        }),
        (Field::Disc, Frame::Map) => {
            let (r0, theta0) = polar_position(arena, shooter);
            let (a0, b0) = (a.eval(0.), b.eval(0.));
            let dir = if clockwise { -1. } else { 1. };
            trace(arena, shooter, range, frame, clockwise, |t| {
                polar(a.eval(t) - a0 + r0, theta0 + dir * (b.eval(t) - b0))
            })
        }
        (Field::Disc, Frame::Player) => trace(arena, shooter, range, frame, clockwise, |t| {
            polar(a.eval(t), b.eval(t))
        }),
    }
}

/// Walks the curve `curve(s)` for `s` in `[0, range]`, anchored at the shooter, applying the
/// collision rules to every sampled point. The world point is `shooter + D(curve(s) − curve(0))`,
/// so the first point is exactly the shooter. With `Frame::Map` the curve is in map coordinates
/// and `D` is the identity. With `Frame::Player`, on XY `D` mirrors x for a shooter right of the
/// centre; on the disc it turns local +x toward the centre and, when `clockwise`, mirrors local y.
fn trace(
    arena: &mut Arena,
    shooter: (usize, usize),
    range: f64,
    frame: Frame,
    clockwise: bool,
    curve: impl Fn(f64) -> Point,
) -> Result<Shot, FireError> {
    let origin = position(arena, shooter);

    let start = curve(0.);
    if !start.x.is_finite() || !start.y.is_finite() {
        return Err(FireError::UndefinedAtShooter);
    }

    // Rows of D
    let [[a, b], [c, d]] = match (frame, arena.field()) {
        (Frame::Player, Field::Xy) if origin.x > 0. => [[-1., 0.], [0., 1.]],
        (Frame::Player, Field::Disc) => {
            let norm = origin.x.hypot(origin.y);
            let (cos, sin) = (-origin.x / norm, -origin.y / norm);
            let flip = if clockwise { -1. } else { 1. };
            [[cos, -flip * sin], [sin, flip * cos]]
        }
        _ => [[1., 0.], [0., 1.]],
    };
    let at = |s: f64| {
        let p = curve(s);
        let (dx, dy) = (p.x - start.x, p.y - start.y);
        Point::new(origin.x + a * dx + b * dy, origin.y + c * dx + d * dy)
    };

    let mut points = Vec::new();
    let (base, min_step) = (range / BASE_STEPS, range * MIN_STEP);
    let (mut s, mut evals) = (0., 1);
    let mut p = at(s);
    loop {
        if !p.x.is_finite() || !p.y.is_finite() || !arena.contains(&p) {
            break;
        }
        points.push(p.clone());
        if arena.blocks(&p) {
            arena.add_crater(p);
            break;
        }
        arena.kill_players_at(&p, shooter);

        let mut step = base;
        let next = loop {
            if step < min_step || evals >= MAX_EVALS {
                return Ok(Shot { points });
            }
            let q = at(s + step);
            evals += 1;
            // A non-finite point is accepted here and ends the shot above
            if !(q.x.is_finite() && q.y.is_finite()) || p.distance_to(&q) <= MAX_GAP {
                break q;
            }
            step /= 2.;
        };
        s += step;
        if s > range {
            break;
        }
        p = next;
    }
    Ok(Shot { points })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::Team;
    use crate::geometry::Circle;

    /// 20 by 10 XY arena: team 0 on the left, team 1 on the right.
    fn xy(obstacles: &[(f64, f64, f64)], left: &[(f64, f64)], right: &[(f64, f64)]) -> Arena {
        let obstacles = obstacles
            .iter()
            .map(|&(x, y, r)| Circle::new((x, y).into(), r))
            .collect();
        Arena::from_parts(
            Field::Xy,
            10.,
            5.,
            obstacles,
            vec![
                Team::from_positions(left, 0.3),
                Team::from_positions(right, 0.3),
            ],
        )
    }

    fn fire(arena: &mut Arena, shooter: (usize, usize), src: &str) -> Shot {
        explicit(
            arena,
            shooter,
            &Formula::parse(src, "x").unwrap(),
            Frame::Map,
            false,
        )
        .unwrap()
    }

    #[test]
    fn straight_shot_kills_and_continues() {
        let mut arena = xy(
            &[],
            &[(-8., 0.), (-4., 0.)],
            &[(0., 0.), (5., 0.), (5., 3.)],
        );
        let shot = fire(&mut arena, (0, 0), "0");

        // The enemy and the teammate in line die, the one off the line survives
        assert_eq!(
            arena.alive(),
            vec![vec![true, false], vec![false, false, true]]
        );
        // The shot went past all of them and stopped at the right edge
        let last = shot.points.last().unwrap();
        assert!(10. - last.x <= MAX_GAP && last.y == 0.);
    }

    #[test]
    fn obstacle_stops_shot_and_leaves_crater() {
        let mut arena = xy(&[(0., 0., 0.25)], &[(-8., 0.)], &[(5., 0.)]);
        let shot = fire(&mut arena, (0, 0), "0");
        let last = shot.points.last().unwrap();
        assert!((-0.25..=-0.2).contains(&last.x), "stopped at {last:?}");
        assert_eq!(arena.holes().len(), 1);
        assert!(arena.alive()[1][0]);

        // The crater is in the way of the same shot: it now passes through and hits the player
        fire(&mut arena, (0, 0), "0");
        assert!(!arena.alive()[1][0]);
    }

    #[test]
    fn stops_at_arena_edge() {
        let mut arena = xy(&[], &[(-8., 0.)], &[(8., 4.)]);
        let shot = fire(&mut arena, (0, 0), "x");
        assert!(shot.points.iter().all(|p| arena.contains(p)));
        let last = shot.points.last().unwrap();
        // y = x from (-8, 0) leaves through the top at y = 5
        assert!(5. - last.y <= MAX_GAP, "stopped at {last:?}");
    }

    #[test]
    fn stops_on_non_finite() {
        let mut arena = xy(&[], &[(-8., 0.)], &[(8., 0.)]);
        // NaN once x > -5
        let shot = fire(&mut arena, (0, 0), "sqrt(-5-x)");
        assert!(shot
            .points
            .iter()
            .all(|p| p.x.is_finite() && p.y.is_finite()));
        let last = shot.points.last().unwrap();
        assert!((-5. - last.x).abs() <= MAX_GAP, "stopped at {last:?}");
        assert!(arena.alive()[1][0]);
    }

    #[test]
    fn points_stay_close_for_steep_curves() {
        let mut arena = xy(&[], &[(-8., 0.)], &[(8., 0.)]);
        let shot = fire(&mut arena, (0, 0), "1000*x");
        assert!(shot.points.len() > 100);
        for w in shot.points.windows(2) {
            assert!(w[0].distance_to(&w[1]) <= MAX_GAP + 1e-12);
        }
    }

    #[test]
    fn discontinuity_ends_the_shot() {
        let mut arena = xy(&[], &[(-8., 0.)], &[(8., 0.)]);
        let shot = fire(&mut arena, (0, 0), "floor(x)*100");
        assert!(shot.points.last().unwrap().x < -7.);
        assert!(arena.alive()[1][0]);
        // It ended at the jump instead of repeating the same point until the evaluation cap
        assert!(shot.points.len() < 1000);
        assert!(shot.points.windows(2).all(|w| w[0] != w[1]));
    }

    #[test]
    fn evaluation_cap_ends_a_wildly_oscillating_shot() {
        let mut arena = xy(&[], &[(-8., 0.)], &[(8., 0.)]);
        let shot = fire(&mut arena, (0, 0), "3*sin(400000*x)");
        assert!(shot.points.len() < 100_000);
        assert!(shot.points.last().unwrap().x < 0.);
    }

    #[test]
    fn xy_shots_depart_from_the_shooter() {
        // Undefined at x = 0, where the old shooter frame started, but not at these shooters
        for (team, shooter, srcs) in [
            (0, (-8., 1.), ["1/x", "sqrt(-x)", "x^2"]),
            (1, (8., 1.), ["1/x", "ln(x)", "x^2"]),
        ] {
            for src in srcs {
                let mut arena = xy(&[], &[(-8., 1.)], &[(8., 1.)]);
                let shot = fire(&mut arena, (team, 0), src);
                assert_eq!(shot.points[0], Point::from(shooter), "{src}");
            }
        }
    }

    #[test]
    fn xy_explicit_shots_use_map_coordinates() {
        for (team, x0) in [(0, -8.), (1, 8.)] {
            // y = c is the horizontal line through the shooter, toward the other half
            let mut arena = xy(&[], &[(-8., 1.)], &[(8., 1.)]);
            let flat = fire(&mut arena, (team, 0), "3");
            assert!(flat.points.iter().all(|p| p.y == 1.));
            assert_eq!(flat.points[1].x > x0, x0 < 0.);
            // y = x has slope 1 in map coordinates from either side: f is not mirrored
            let mut arena = xy(&[], &[(-8., 1.)], &[(8., 1.)]);
            let diagonal = fire(&mut arena, (team, 0), "x");
            assert!(diagonal.points.len() > 10);
            for p in &diagonal.points {
                assert!((p.y - 1. - (p.x - x0)).abs() < 1e-9, "{p:?}");
            }
            assert_eq!(diagonal.points[1].x > x0, x0 < 0.);
        }
    }

    #[test]
    fn xy_parametric_shot_departs_from_the_shooter_unmirrored() {
        // x(t) = 5 - t heads left in map coordinates, offset to start at the shooter (8, 1)
        let mut arena = xy(&[], &[(-8., 1.)], &[(8., 1.), (0., 1.)]);
        let shot = parametric(&mut arena, (1, 0), &t("5-t"), &t("2"), Frame::Map, false).unwrap();
        assert_eq!(shot.points[0], Point::new(8., 1.));
        assert!(shot.points.iter().all(|p| p.y == 1.));
        assert_eq!(arena.alive(), vec![vec![false], vec![true, false]]);
    }

    #[test]
    fn xy_parametric_shot() {
        let mut arena = xy(&[], &[(-8., 0.)], &[(0., 4.)]);
        let (a, b) = (
            Formula::parse("t", "t").unwrap(),
            Formula::parse("t/2", "t").unwrap(),
        );
        parametric(&mut arena, (0, 0), &a, &b, Frame::Map, false).unwrap();
        assert!(!arena.alive()[1][0]);
    }

    fn disc(shooter: (f64, f64)) -> Arena {
        Arena::from_parts(
            Field::Disc,
            10.,
            10.,
            vec![],
            vec![
                Team::from_positions(&[shooter], 0.3),
                Team::from_positions(&[(0., 0.)], 0.3),
            ],
        )
    }

    /// Shooters at the map angles 0, π/2, π, 3π/2 and 3π/4.
    const SHOOTERS: [(f64, f64); 5] = [(8., 0.), (0., 8.), (-8., 0.), (0., -8.), (-5., 5.)];

    fn theta(src: &str) -> Formula {
        Formula::parse(src, "θ").unwrap()
    }

    fn t(src: &str) -> Formula {
        Formula::parse(src, "t").unwrap()
    }

    fn radius(p: &Point) -> f64 {
        p.x.hypot(p.y)
    }

    #[test]
    fn disc_shots_depart_from_the_shooter() {
        // ln(θ) is undefined at θ = 0, but these shooters start at θ₀ > 0
        for shooter in &SHOOTERS[1..] {
            for clockwise in [false, true] {
                for src in ["θ", "3", "ln(θ)", "θ^2"] {
                    let shot = explicit(
                        &mut disc(*shooter),
                        (0, 0),
                        &theta(src),
                        Frame::Map,
                        clockwise,
                    );
                    assert_eq!(shot.unwrap().points[0], Point::from(*shooter), "{src}");
                }
                let shot = parametric(
                    &mut disc(*shooter),
                    (0, 0),
                    &t("t+3"),
                    &t("t+1"),
                    Frame::Map,
                    clockwise,
                );
                assert_eq!(shot.unwrap().points[0], Point::from(*shooter));
            }
        }
    }

    #[test]
    fn constant_radius_orbits_the_centre() {
        for shooter in SHOOTERS {
            let r = radius(&shooter.into());
            for clockwise in [false, true] {
                let shot = explicit(
                    &mut disc(shooter),
                    (0, 0),
                    &theta("3"),
                    Frame::Map,
                    clockwise,
                )
                .unwrap();
                let param = parametric(
                    &mut disc(shooter),
                    (0, 0),
                    &t("3"),
                    &t("t"),
                    Frame::Map,
                    clockwise,
                )
                .unwrap();
                for p in shot.points.iter().chain(&param.points) {
                    assert!((radius(p) - r).abs() < 1e-9, "{shooter:?}: {p:?}");
                }
                // One full turn in the requested direction, ending back at the shooter
                let (a, b) = (&shot.points[0], &shot.points[1]);
                assert_eq!(a.x * b.y - a.y * b.x > 0., !clockwise);
                let last = shot.points.last().unwrap();
                assert!(last.distance_to(&shooter.into()) <= MAX_GAP);
                assert!(shot.points.len() > 1000);
            }
        }
    }

    #[test]
    fn theta_spirals_outward_from_the_shooter() {
        for shooter in SHOOTERS {
            let r = radius(&shooter.into());
            let theta0 = shooter.1.atan2(shooter.0).rem_euclid(TAU);
            let shot =
                explicit(&mut disc(shooter), (0, 0), &theta("θ"), Frame::Map, false).unwrap();
            assert!(shot.points.len() > 10);
            // r = r_shooter + (θ − θ₀); it leaves the disc before a full turn
            for p in &shot.points {
                let swept = (p.y.atan2(p.x) - theta0).rem_euclid(TAU);
                assert!((radius(p) - r - swept).abs() < 1e-9, "{shooter:?}: {p:?}");
            }
            assert!(10. - radius(shot.points.last().unwrap()) <= MAX_GAP);
        }
    }

    #[test]
    fn polar_parametric_straight_shot_hits_the_centre() {
        let mut arena = disc((0., 8.));
        let shot = parametric(&mut arena, (0, 0), &t("-t"), &t("0"), Frame::Map, false).unwrap();
        assert!(!arena.alive()[1][0]);
        // A negative radius goes through the centre to the far side of the disc
        assert!(shot.points.last().unwrap().y < -9.9);
    }

    /// `p` reflected across the line through the disc centre and `shooter`.
    fn mirror(p: &Point, shooter: (f64, f64)) -> (f64, f64) {
        let n = shooter.0.hypot(shooter.1);
        let (ux, uy) = (shooter.0 / n, shooter.1 / n);
        let dot = p.x * ux + p.y * uy;
        (2. * dot * ux - p.x, 2. * dot * uy - p.y)
    }

    fn assert_mirrored(ccw: &Shot, cw: &Shot, shooter: (f64, f64)) {
        assert!(ccw.points.len() > 10);
        assert_eq!(ccw.points.len(), cw.points.len());
        for (a, b) in ccw.points.iter().zip(&cw.points) {
            let m = mirror(a, shooter);
            assert!((m.0 - b.x).abs() < 1e-9 && (m.1 - b.y).abs() < 1e-9);
        }
        assert_ne!(ccw, cw);
    }

    #[test]
    fn clockwise_explicit_shot_sweeps_theta_downward() {
        // cos(2θ) is even around these shooters' θ₀, so clockwise is the mirror image
        let even = theta("cos(2*θ)/2");
        for shooter in &SHOOTERS[..4] {
            let ccw = explicit(&mut disc(*shooter), (0, 0), &even, Frame::Map, false).unwrap();
            let cw = explicit(&mut disc(*shooter), (0, 0), &even, Frame::Map, true).unwrap();
            assert_mirrored(&ccw, &cw, *shooter);
        }
        // f is evaluated at the actual θ, so clockwise r = θ spirals inward for a full turn
        for shooter in SHOOTERS {
            let r = radius(&shooter.into());
            let cw = explicit(&mut disc(shooter), (0, 0), &theta("θ"), Frame::Map, true).unwrap();
            let (a, b) = (&cw.points[0], &cw.points[1]);
            assert!(a.x * b.y - a.y * b.x < 0.);
            assert!(cw.points.windows(2).all(|w| radius(&w[1]) < radius(&w[0])));
            assert!((radius(cw.points.last().unwrap()) - (r - TAU)).abs() <= MAX_GAP);
        }
    }

    #[test]
    fn clockwise_parametric_shot_mirrors_across_the_centre_axis() {
        for shooter in SHOOTERS {
            let ccw = parametric(
                &mut disc(shooter),
                (0, 0),
                &t("-t"),
                &t("t/3"),
                Frame::Map,
                false,
            )
            .unwrap();
            let cw = parametric(
                &mut disc(shooter),
                (0, 0),
                &t("-t"),
                &t("t/3"),
                Frame::Map,
                true,
            )
            .unwrap();
            assert_mirrored(&ccw, &cw, shooter);
            // θ(t) = t/3 turns counter-clockwise around the centre, starting at the shooter, and
            // r = r_shooter − t goes through the centre
            let (a, b) = (&ccw.points[0], &ccw.points[1]);
            assert!(a.x * b.y - a.y * b.x > 0.);
            assert!(ccw.points.iter().any(|p| radius(p) <= MAX_GAP));
        }
    }

    #[test]
    fn undefined_at_the_shooters_angle_is_an_error() {
        // A shooter at (-8, 0) starts at θ₀ = π
        let mut arena = disc((-8., 0.));
        for src in ["1/(θ-pi)", "ln(θ-pi)"] {
            assert_eq!(
                explicit(&mut arena, (0, 0), &theta(src), Frame::Map, false),
                Err(FireError::UndefinedAtShooter)
            );
        }
        for (r, th) in [("1/t", "t"), ("t", "ln(t)")] {
            assert_eq!(
                parametric(&mut arena, (0, 0), &t(r), &t(th), Frame::Map, false),
                Err(FireError::UndefinedAtShooter)
            );
        }
        // Undefined at θ = 0 only, where this shooter does not start
        assert!(explicit(&mut arena, (0, 0), &theta("1/θ"), Frame::Map, false).is_ok());
    }

    #[test]
    fn clockwise_is_ignored_on_xy() {
        let (a, b) = (
            Formula::parse("t", "t").unwrap(),
            Formula::parse("t/2", "t").unwrap(),
        );
        let x = Formula::parse("x", "x").unwrap();
        for frame in [Frame::Map, Frame::Player] {
            let run = |cw| {
                let mut arena = xy(&[], &[(-8., 0.)], &[(8., 0.)]);
                let explicit = explicit(&mut arena, (0, 0), &x, frame, cw).unwrap();
                (
                    explicit,
                    parametric(&mut arena, (1, 0), &a, &b, frame, cw).unwrap(),
                )
            };
            assert_eq!(run(false), run(true));
        }
    }

    // The player frame (ADR 4, 5, 14): shots in the shooter's local frame, facing the centre.

    #[test]
    fn player_frame_xy_shots_head_toward_the_centre() {
        let x = Formula::parse("x", "x").unwrap();
        let mut arena = xy(&[], &[(-8., 0.)], &[(8., 0.)]);
        let left = explicit(&mut arena, (0, 0), &x, Frame::Player, false).unwrap();
        let right = explicit(&mut arena, (1, 0), &x, Frame::Player, false).unwrap();
        let (l, r) = (&left.points[1], &right.points[1]);
        assert!(l.x > -8. && l.y > 0.);
        assert!(r.x < 8. && r.y > 0.);
        // Parametric shots are mirrored too, and start at local t = 0
        let mut arena = xy(&[], &[(-8., 0.)], &[(8., 0.), (0., 4.)]);
        parametric(&mut arena, (1, 0), &t("t"), &t("t/2"), Frame::Player, false).unwrap();
        assert!(!arena.alive()[1][1]);
    }

    #[test]
    fn player_frame_polar_faces_the_centre() {
        // r = θ starts along the local +x axis, which must point at the centre
        for shooter in [(8., 0.), (0., -8.), (-5., 5.)] {
            let mut arena = disc(shooter);
            let shot = explicit(&mut arena, (0, 0), &theta("θ"), Frame::Player, false).unwrap();
            let (first, second) = (&shot.points[0], &shot.points[3]);
            let toward_centre = (-first.x, -first.y);
            let step = (second.x - first.x, second.y - first.y);
            let cos = (step.0 * toward_centre.0 + step.1 * toward_centre.1)
                / (step.0.hypot(step.1) * toward_centre.0.hypot(toward_centre.1));
            assert!(cos > 0.99, "shooter {shooter:?}, cos {cos}");
        }
    }

    #[test]
    fn player_frame_parametric_straight_shot_hits_the_centre() {
        let mut arena = disc((0., 8.));
        let shot = parametric(&mut arena, (0, 0), &t("t"), &t("0"), Frame::Player, false).unwrap();
        assert!(!arena.alive()[1][0]);
        // It keeps going to the far side of the disc
        assert!(shot.points.last().unwrap().y < -9.9);
    }

    #[test]
    fn player_frame_clockwise_mirrors_across_the_centre_axis() {
        for shooter in [(8., 0.), (0., -8.), (-5., 5.)] {
            let fire = |cw| explicit(&mut disc(shooter), (0, 0), &theta("θ"), Frame::Player, cw);
            assert_mirrored(&fire(false).unwrap(), &fire(true).unwrap(), shooter);
            let fire = |cw| {
                parametric(
                    &mut disc(shooter),
                    (0, 0),
                    &t("t"),
                    &t("t/3"),
                    Frame::Player,
                    cw,
                )
            };
            assert_mirrored(&fire(false).unwrap(), &fire(true).unwrap(), shooter);
        }
    }

    #[test]
    fn player_frame_is_undefined_at_local_zero() {
        // The local curve starts at x = 0 or θ = 0 wherever the shooter is
        let mut arena = xy(&[], &[(-8., 0.)], &[(8., 0.)]);
        let x = Formula::parse("1/x", "x").unwrap();
        assert_eq!(
            explicit(&mut arena, (1, 0), &x, Frame::Player, false),
            Err(FireError::UndefinedAtShooter)
        );
        assert_eq!(
            explicit(
                &mut disc((-8., 0.)),
                (0, 0),
                &theta("1/θ"),
                Frame::Player,
                false
            ),
            Err(FireError::UndefinedAtShooter)
        );
    }
}
