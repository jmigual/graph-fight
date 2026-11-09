//! Shot sampling and collisions (ADR 4 and 5).

// tsify 0.5 deprecates `into_wasm_abi` (it panics on a failed conversion, and unwinding
// leaks). These types only serialize, so the conversion cannot fail; `Ts<T>` would change the
// signatures the Rust tests call.
#![expect(deprecated)]

use std::{f64::consts::TAU, fmt};

use serde::Serialize;
use tsify::Tsify;

use super::{Arena, Field};
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

/// The point at polar coordinates `(r, theta)`.
fn polar(r: f64, theta: f64) -> Point {
    Point::new(r * theta.cos(), r * theta.sin())
}

/// Fires `y = f(x)` on the XY field or `r = f(θ)` on the disc, from `shooter` (team, player).
/// `clockwise` mirrors a disc shot across the shooter-to-centre axis and is ignored on XY.
pub fn explicit(
    arena: &mut Arena,
    shooter: (usize, usize),
    f: &Formula,
    clockwise: bool,
) -> Result<Shot, FireError> {
    match arena.field() {
        Field::Xy => {
            let range = 2. * arena.x_max();
            trace(arena, shooter, range, clockwise, |x| {
                Point::new(x, f.eval(x))
            })
        }
        Field::Disc => trace(arena, shooter, TAU, clockwise, |theta| {
            polar(f.eval(theta), theta)
        }),
    }
}

/// Fires `x(t), y(t)` on the XY field or `r(t), θ(t)` on the disc, from `shooter` (team, player).
/// `clockwise` mirrors a disc shot across the shooter-to-centre axis and is ignored on XY.
pub fn parametric(
    arena: &mut Arena,
    shooter: (usize, usize),
    a: &Formula,
    b: &Formula,
    clockwise: bool,
) -> Result<Shot, FireError> {
    match arena.field() {
        Field::Xy => {
            let range = 2. * arena.x_max();
            trace(arena, shooter, range, clockwise, |t| {
                Point::new(a.eval(t), b.eval(t))
            })
        }
        Field::Disc => {
            let range = 2. * arena.y_max();
            trace(arena, shooter, range, clockwise, |t| {
                polar(a.eval(t), b.eval(t))
            })
        }
    }
}

/// Walks the local curve `local(s)` for `s` in `[0, range]`, anchored at the shooter and oriented
/// toward the field centre, applying the collision rules to every sampled point. On the disc,
/// `clockwise` reflects the local frame across its x axis (θ → −θ); the XY mirror is automatic.
fn trace(
    arena: &mut Arena,
    shooter: (usize, usize),
    range: f64,
    clockwise: bool,
    local: impl Fn(f64) -> Point,
) -> Result<Shot, FireError> {
    let origin = arena.get_teams()[shooter.0].players()[shooter.1]
        .shape()
        .pos()
        .clone();

    let start = local(0.);
    if !start.x.is_finite() || !start.y.is_finite() {
        return Err(FireError::UndefinedAtShooter);
    }

    // Rows of D: a mirror of x on XY for a shooter right of the centre, otherwise the rotation
    // that turns local +x toward the centre, followed by a mirror of local y when clockwise.
    let [[a, b], [c, d]] = match arena.field() {
        Field::Xy if origin.x > 0. => [[-1., 0.], [0., 1.]],
        Field::Xy => [[1., 0.], [0., 1.]],
        Field::Disc => {
            let norm = origin.x.hypot(origin.y);
            let (cos, sin) = (-origin.x / norm, -origin.y / norm);
            let flip = if clockwise { -1. } else { 1. };
            [[cos, -flip * sin], [sin, flip * cos]]
        }
    };
    let at = |s: f64| {
        let p = local(s);
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
        explicit(arena, shooter, &Formula::parse(src, "x").unwrap(), false).unwrap()
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
        // NaN once x > 3 (local), i.e. world x > -5
        let shot = fire(&mut arena, (0, 0), "sqrt(3-x)");
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
    fn xy_shots_head_toward_the_centre() {
        let mut arena = xy(&[], &[(-8., 0.)], &[(8., 0.)]);
        let left = fire(&mut arena, (0, 0), "x");
        let right = fire(&mut arena, (1, 0), "x");
        let (l, r) = (&left.points[1], &right.points[1]);
        assert!(l.x > -8. && l.y > 0.);
        assert!(r.x < 8. && r.y > 0.);
    }

    #[test]
    fn xy_parametric_shot() {
        let mut arena = xy(&[], &[(-8., 0.)], &[(0., 4.)]);
        let (a, b) = (
            Formula::parse("t", "t").unwrap(),
            Formula::parse("t/2", "t").unwrap(),
        );
        parametric(&mut arena, (0, 0), &a, &b, false).unwrap();
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

    #[test]
    fn polar_frame_faces_the_centre() {
        // r = θ starts along the local +x axis, which must point at the centre
        for shooter in [(8., 0.), (0., -8.), (-5., 5.)] {
            let mut arena = disc(shooter);
            let theta = Formula::parse("θ", "θ").unwrap();
            let shot = explicit(&mut arena, (0, 0), &theta, false).unwrap();
            let (first, second) = (&shot.points[0], &shot.points[3]);
            let toward_centre = (-first.x, -first.y);
            let step = (second.x - first.x, second.y - first.y);
            let cos = (step.0 * toward_centre.0 + step.1 * toward_centre.1)
                / (step.0.hypot(step.1) * toward_centre.0.hypot(toward_centre.1));
            assert!(cos > 0.99, "shooter {shooter:?}, cos {cos}");
        }
    }

    #[test]
    fn polar_parametric_straight_shot_hits_the_centre() {
        let mut arena = disc((0., 8.));
        let (r, theta) = (
            Formula::parse("t", "t").unwrap(),
            Formula::parse("0", "t").unwrap(),
        );
        let shot = parametric(&mut arena, (0, 0), &r, &theta, false).unwrap();
        assert!(!arena.alive()[1][0]);
        // It keeps going to the far side of the disc
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
    fn clockwise_explicit_shot_mirrors_across_the_centre_axis() {
        let theta = Formula::parse("θ", "θ").unwrap();
        for shooter in [(8., 0.), (0., -8.), (-5., 5.)] {
            let ccw = explicit(&mut disc(shooter), (0, 0), &theta, false).unwrap();
            let cw = explicit(&mut disc(shooter), (0, 0), &theta, true).unwrap();
            assert_mirrored(&ccw, &cw, shooter);
        }
    }

    #[test]
    fn clockwise_parametric_shot_mirrors_across_the_centre_axis() {
        let (r, theta) = (
            Formula::parse("t", "t").unwrap(),
            Formula::parse("t/3", "t").unwrap(),
        );
        for shooter in [(8., 0.), (0., -8.), (-5., 5.)] {
            let ccw = parametric(&mut disc(shooter), (0, 0), &r, &theta, false).unwrap();
            let cw = parametric(&mut disc(shooter), (0, 0), &r, &theta, true).unwrap();
            assert_mirrored(&ccw, &cw, shooter);
        }
    }

    #[test]
    fn clockwise_is_ignored_on_xy() {
        let (a, b) = (
            Formula::parse("t", "t").unwrap(),
            Formula::parse("t/2", "t").unwrap(),
        );
        let x = Formula::parse("x", "x").unwrap();
        let run = |cw| {
            let mut arena = xy(&[], &[(-8., 0.)], &[(8., 0.)]);
            let explicit = explicit(&mut arena, (0, 0), &x, cw).unwrap();
            (
                explicit,
                parametric(&mut arena, (1, 0), &a, &b, cw).unwrap(),
            )
        };
        assert_eq!(run(false), run(true));
    }
}
