//! The test arena (ADR 25): a game built from players and obstacles placed by hand, fired from any
//! player without changing it. Nothing here runs in a multiplayer game.

// tsify 0.5 deprecates `into_wasm_abi` and `from_wasm_abi` (they panic or throw on a failed
// conversion, and unwinding leaks). `TrialShot` only serializes, so that conversion cannot fail;
// the placed players and obstacles come from the client's own test arena.
#![expect(deprecated)]

use rand::SeedableRng;
use rand::rngs::SmallRng;
use serde::{Deserialize, Serialize};
use tsify::Tsify;
use wasm_bindgen::prelude::*;

use super::{
    Arena, Field, FireError, Frame, Game, GameError, MAX_ITERS, Options, Shot, Team, is_positive,
    shot,
};
use crate::formula::Formula;
use crate::geometry::{Circle, Point};
use crate::utils;

/// Most teams a test arena takes: one per team colour (ADR 17).
const MAX_TEAMS: usize = 8;

/// A player placed by hand: its centre and its team index.
#[derive(Deserialize, Tsify)]
#[tsify(from_wasm_abi)]
pub struct PlacedPlayer {
    pub x: f64,
    pub y: f64,
    pub team: usize,
}

/// An obstacle placed by hand: its centre and its radius.
#[derive(Deserialize, Tsify)]
#[tsify(from_wasm_abi)]
pub struct PlacedObstacle {
    pub x: f64,
    pub y: f64,
    pub r: f64,
}

/// A shot fired without changing the game: its trajectory as in `Shot`, the players it hit as
/// `[team, player]`, and the obstacles (by index) it stopped in.
#[derive(Clone, Debug, PartialEq, Serialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct TrialShot {
    pub points: Vec<Point>,
    pub hits: Vec<[usize; 2]>,
    pub obstacles: Vec<usize>,
}

#[wasm_bindgen]
impl Game {
    /// A test arena on `field` with shots in `frame`, extents as in `new`, the given `players` (of
    /// radius `player_radius`, grouped by team in the order given) and `obstacles`. Every player
    /// lies fully inside the field and touches no obstacle and no other player; obstacles lie in
    /// the field as in a generated game. There are at least two teams, empty ones included.
    pub fn sandbox(
        field: Field,
        frame: Frame,
        x_max: f64,
        y_max: f64,
        player_radius: f64,
        players: Vec<PlacedPlayer>,
        obstacles: Vec<PlacedObstacle>,
    ) -> Result<Game, GameError> {
        utils::set_panic_hook();

        if !is_positive(x_max) || !is_positive(y_max) {
            return Err(GameError::NonPositiveExtent);
        }
        if field == Field::Disc && x_max != y_max {
            return Err(GameError::DiscNotSquare);
        }
        if !is_positive(player_radius) || !obstacles.iter().all(|o| is_positive(o.r)) {
            return Err(GameError::NonPositiveSize);
        }

        let obstacles = obstacles
            .iter()
            .map(|o| Circle::new(Point::new(o.x, o.y), o.r))
            .collect();
        let mut arena = Arena::from_parts(field, x_max, y_max, obstacles, Vec::new());
        if !arena.obstacles().iter().all(|o| arena.obstacle_fits(o)) {
            return Err(GameError::ObstacleOutside);
        }

        let mut placed: Vec<Circle> = Vec::with_capacity(players.len());
        for p in &players {
            if p.team >= MAX_TEAMS {
                return Err(GameError::TeamOutOfRange);
            }
            let shape = Circle::new(Point::new(p.x, p.y), player_radius);
            if !arena.player_fits(&shape) {
                return Err(GameError::PlayerOutside);
            }
            if arena.collision_with_obstacle(&shape) {
                return Err(GameError::PlayerOnObstacle);
            }
            if placed.iter().any(|q| q.collision_circle(&shape)) {
                return Err(GameError::PlayersOverlap);
            }
            placed.push(shape);
        }

        // Two teams at least, as in every game, so the turn methods always find a team.
        let teams = players.iter().map(|p| p.team + 1).max().unwrap_or(0).max(2);
        *arena.get_teams_mut() = (0..teams)
            .map(|t| {
                let positions: Vec<_> = players
                    .iter()
                    .filter(|p| p.team == t)
                    .map(|p| (p.x, p.y))
                    .collect();
                Team::from_positions(&positions, player_radius)
            })
            .collect();
        let players_per_team = arena
            .get_teams()
            .iter()
            .map(|t| t.players().len())
            .collect();

        Ok(Game {
            arena,
            frame,
            // Only `init` reads the options, and a test arena never runs it.
            ops: Options {
                num_obstacles: 0,
                min_obstacle_size: player_radius,
                max_obstacle_size: player_radius,
                players_per_team,
                player_radius,
                seed: 0,
            },
            current_team: 0,
        })
    }

    /// A copy of this game whose obstacles are `num_obstacles` new ones, drawn from `seed` by the
    /// generator of `new` (sizes between `min_obstacle_size` and `max_obstacle_size`, clear of the
    /// players). Its own obstacles are dropped.
    pub fn with_random_obstacles(
        &self,
        num_obstacles: usize,
        min_obstacle_size: f64,
        max_obstacle_size: f64,
        seed: u64,
    ) -> Result<Game, GameError> {
        if !is_positive(min_obstacle_size) || !is_positive(max_obstacle_size) {
            return Err(GameError::NonPositiveSize);
        }
        if min_obstacle_size > max_obstacle_size {
            return Err(GameError::ObstacleSizeRange);
        }
        let mut rng = SmallRng::seed_from_u64(seed);
        let (field, x_max, y_max) = (self.arena.field(), self.arena.x_max(), self.arena.y_max());
        for _ in 1..MAX_ITERS {
            let teams = self.arena.get_teams().clone();
            let mut arena = Arena::from_parts(field, x_max, y_max, Vec::new(), teams);
            if arena
                .add_obstacles(
                    num_obstacles,
                    min_obstacle_size,
                    max_obstacle_size,
                    &mut rng,
                )
                .is_ok()
            {
                return Ok(Game {
                    arena,
                    ..self.clone()
                });
            }
        }
        Err(GameError::NoValidLayout)
    }

    /// Fires `expr` like `fire`, but from player `player` of team `team` and without changing the
    /// game or the turn.
    pub fn fire_from(
        &self,
        team: usize,
        player: usize,
        expr: &str,
        clockwise: bool,
    ) -> Result<TrialShot, FireError> {
        let f = Formula::parse(expr, self.variable())?;
        let frame = self.frame;
        self.trial((team, player), |arena, shooter| {
            shot::explicit(arena, shooter, &f, frame, clockwise)
        })
    }

    /// Fires `a`, `b` like `fire_param`, but from player `player` of team `team` and without
    /// changing the game or the turn.
    pub fn fire_param_from(
        &self,
        team: usize,
        player: usize,
        a: &str,
        b: &str,
        clockwise: bool,
    ) -> Result<TrialShot, FireError> {
        let (a, b) = (Formula::parse(a, "t")?, Formula::parse(b, "t")?);
        let frame = self.frame;
        self.trial((team, player), |arena, shooter| {
            shot::parametric(arena, shooter, &a, &b, frame, clockwise)
        })
    }
}

impl Game {
    /// Runs `trace` from `shooter` on a copy of the arena and reports what it hit: the players
    /// alive before and dead after, and the obstacles holding the point where it stopped.
    fn trial(
        &self,
        shooter: (usize, usize),
        trace: impl FnOnce(&mut Arena, (usize, usize)) -> Result<Shot, FireError>,
    ) -> Result<TrialShot, FireError> {
        let teams = self.arena.get_teams();
        if teams
            .get(shooter.0)
            .and_then(|t| t.players().get(shooter.1))
            .is_none()
        {
            return Err(FireError::UnknownPlayer);
        }
        let mut after = self.arena.clone();
        let points = trace(&mut after, shooter)?.points;

        let hits = teams
            .iter()
            .zip(after.get_teams())
            .enumerate()
            .flat_map(|(t, (before, after))| {
                before
                    .players()
                    .iter()
                    .zip(after.players())
                    .enumerate()
                    .filter(|(_, (p, q))| p.alive() && !q.alive())
                    .map(move |(i, _)| [t, i])
            })
            .collect();
        // A shot that stops in an obstacle ends on the point inside it (ADR 14).
        let obstacles = match points.last() {
            Some(end) if self.arena.blocks(end) => self
                .arena
                .obstacles()
                .iter()
                .enumerate()
                .filter(|(_, o)| o.contains(end))
                .map(|(i, _)| i)
                .collect(),
            _ => Vec::new(),
        };
        Ok(TrialShot {
            points,
            hits,
            obstacles,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::formula::ParseError;

    fn player(x: f64, y: f64, team: usize) -> PlacedPlayer {
        PlacedPlayer { x, y, team }
    }

    fn obstacle(x: f64, y: f64, r: f64) -> PlacedObstacle {
        PlacedObstacle { x, y, r }
    }

    /// The arena constants of `js/index.ts`: XY 20 by 10, a disc of radius 10, players of 0.3.
    fn sandbox(
        field: Field,
        frame: Frame,
        players: Vec<PlacedPlayer>,
        obstacles: Vec<PlacedObstacle>,
    ) -> Result<Game, GameError> {
        let x_max = if field == Field::Xy { 20. } else { 10. };
        Game::sandbox(field, frame, x_max, 10., 0.3, players, obstacles)
    }

    /// Team 0 at (-8, 0) and (-3, 4), team 1 at (5, 0).
    fn three(field: Field, frame: Frame) -> Game {
        let players = vec![player(-8., 0., 0), player(5., 0., 1), player(-3., 4., 0)];
        sandbox(field, frame, players, vec![]).unwrap()
    }

    #[test]
    fn shots_start_at_the_chosen_player() {
        for field in [Field::Xy, Field::Disc] {
            for frame in [Frame::Map, Frame::Player] {
                let game = three(field, frame);
                for (team, i, at) in [(0, 0, (-8., 0.)), (0, 1, (-3., 4.)), (1, 0, (5., 0.))] {
                    for cw in [false, true] {
                        let shot = game.fire_from(team, i, "1", cw).unwrap();
                        assert_eq!(shot.points[0], Point::from(at), "{field:?} {frame:?}");
                        let shot = game.fire_param_from(team, i, "t", "1", cw).unwrap();
                        assert_eq!(shot.points[0], Point::from(at), "{field:?} {frame:?}");
                    }
                }
            }
        }
    }

    #[test]
    fn a_player_at_the_disc_centre_fires_along_plus_x() {
        // The centre has no direction to face; the player frame then faces +x, as the board does
        for frame in [Frame::Map, Frame::Player] {
            let players = vec![player(0., 0., 0), player(5., 0., 1)];
            let game = sandbox(Field::Disc, frame, players, vec![]).unwrap();
            for cw in [false, true] {
                let shot = game.fire_param_from(0, 0, "t", "0", cw).unwrap();
                assert_eq!(shot.points[0], Point::new(0., 0.), "{frame:?}");
                assert_eq!(shot.hits, vec![[1, 0]], "{frame:?}");
                let shot = game.fire_from(0, 0, "θ", cw).unwrap();
                assert_eq!(shot.points[0], Point::new(0., 0.), "{frame:?}");
                assert!(shot.points.len() > 10, "{frame:?}");
            }
        }
    }

    #[test]
    fn hits_are_reported_and_the_game_is_unchanged() {
        let game = three(Field::Xy, Frame::Map);
        let (arena, turn) = (game.js_arena(), game.get_current_team_idx());
        // y = 0 from (-8, 0) runs through the enemy at (5, 0) to the right edge
        let shot = game.fire_from(0, 0, "0", false).unwrap();
        assert_eq!(shot.hits, vec![[1, 0]]);
        assert!(shot.obstacles.is_empty());
        assert!(20. - shot.points.last().unwrap().x <= 0.05);
        // Friendly fire counts: x(t) = t, y(t) = 4t/5 from (-8, 0) passes the teammate at (-3, 4)
        let shot = game.fire_param_from(0, 0, "t", "4*t/5", false).unwrap();
        assert_eq!(shot.hits, vec![[0, 1]]);

        // Nothing died, the turn did not move, and the same shot does the same again
        assert!(game.js_arena() == arena);
        assert_eq!(game.get_current_team_idx(), turn);
        assert_eq!(game.fire_from(0, 0, "0", false).unwrap().hits, vec![[1, 0]]);
    }

    #[test]
    fn an_obstacle_stops_the_shot_and_leaves_no_crater() {
        let players = vec![player(-8., 0., 0), player(5., 0., 1)];
        let obstacles = vec![obstacle(0., 5., 1.), obstacle(0., 0., 1.)];
        let game = sandbox(Field::Xy, Frame::Map, players, obstacles).unwrap();
        let arena = game.js_arena();
        for _ in 0..2 {
            let shot = game.fire_from(0, 0, "0", false).unwrap();
            assert!(shot.hits.is_empty());
            assert_eq!(shot.obstacles, vec![1]);
            let end = shot.points.last().unwrap();
            assert!((-1.0..=-0.95).contains(&end.x), "stopped at {end:?}");
        }
        assert!(game.js_arena() == arena);
    }

    #[test]
    fn disc_hits_in_both_frames() {
        let players = vec![player(8., 0., 0), player(-5., 0., 1)];
        let map = sandbox(Field::Disc, Frame::Map, players, vec![]).unwrap();
        assert_eq!(
            map.fire_param_from(0, 0, "-t", "0", false).unwrap().hits,
            vec![[1, 0]]
        );
        let players = vec![player(8., 0., 0), player(-5., 0., 1)];
        let own = sandbox(Field::Disc, Frame::Player, players, vec![]).unwrap();
        assert_eq!(
            own.fire_param_from(0, 0, "t", "0", true).unwrap().hits,
            vec![[1, 0]]
        );
    }

    #[test]
    fn an_empty_arena_works() {
        for field in [Field::Xy, Field::Disc] {
            let empty = sandbox(field, Frame::Map, vec![], vec![]).unwrap();
            assert_eq!(empty.js_arena().get_teams().len(), 2);
            assert!(empty.js_arena().obstacles().is_empty());
            // The turn methods find no shooter and do nothing
            let mut turn = empty.clone();
            assert!(turn.fire("1", false).unwrap().points.is_empty());
            turn.skip_turn();

            // One player alone: a shot that hits nothing and leaves the field
            let alone = sandbox(field, Frame::Map, vec![player(0., 2., 1)], vec![]).unwrap();
            assert_eq!(alone.js_arena().get_teams()[0].players().len(), 0);
            let shot = alone.fire_from(1, 0, "1", false).unwrap();
            assert!(shot.points.len() > 10);
            assert!(shot.hits.is_empty() && shot.obstacles.is_empty());
        }
    }

    #[test]
    fn invalid_placement_is_rejected() {
        let err = |field, players, obstacles| sandbox(field, Frame::Map, players, obstacles).err();
        use GameError::*;
        // The player's edge, not only its centre, must be inside the field
        for field in [Field::Xy, Field::Disc] {
            let x = if field == Field::Xy { 19.8 } else { 9.8 };
            assert_eq!(
                err(field, vec![player(x, 0., 0)], vec![]),
                Some(PlayerOutside)
            );
            assert_eq!(
                err(field, vec![player(f64::NAN, 0., 0)], vec![]),
                Some(PlayerOutside)
            );
            assert_eq!(
                err(field, vec![player(0., f64::INFINITY, 0)], vec![]),
                Some(PlayerOutside)
            );
        }
        // (8, 8) is inside the XY rectangle but outside the disc
        assert!(err(Field::Xy, vec![player(8., 8., 0)], vec![]).is_none());
        assert_eq!(
            err(Field::Disc, vec![player(8., 8., 0)], vec![]),
            Some(PlayerOutside)
        );
        // Obstacles follow the generated games: fully inside the disc, centre inside on XY
        assert!(err(Field::Xy, vec![], vec![obstacle(19.5, 0., 1.)]).is_none());
        assert_eq!(
            err(Field::Disc, vec![], vec![obstacle(9.5, 0., 1.)]),
            Some(ObstacleOutside)
        );
        assert_eq!(
            err(Field::Xy, vec![], vec![obstacle(f64::NAN, 0., 1.)]),
            Some(ObstacleOutside)
        );
        for r in [0., -1., f64::NAN, f64::INFINITY] {
            assert_eq!(
                err(Field::Xy, vec![], vec![obstacle(0., 0., r)]),
                Some(NonPositiveSize)
            );
        }
        assert_eq!(
            err(
                Field::Xy,
                vec![player(1.2, 0., 0)],
                vec![obstacle(0., 0., 1.)]
            ),
            Some(PlayerOnObstacle)
        );
        assert_eq!(
            err(
                Field::Xy,
                vec![player(0., 0., 0), player(0.5, 0., 1)],
                vec![]
            ),
            Some(PlayersOverlap)
        );
        assert_eq!(
            err(Field::Disc, vec![player(0., 0., 8)], vec![]),
            Some(TeamOutOfRange)
        );
        assert!(err(Field::Disc, vec![player(0., 0., 7)], vec![]).is_none());
        // The extents and the radius are checked as in `new`
        let new = |field, x_max, radius| {
            Game::sandbox(field, Frame::Map, x_max, 10., radius, vec![], vec![]).err()
        };
        assert_eq!(new(Field::Disc, 20., 0.3), Some(DiscNotSquare));
        assert_eq!(new(Field::Xy, f64::NAN, 0.3), Some(NonPositiveExtent));
        assert_eq!(new(Field::Xy, 20., 0.), Some(NonPositiveSize));
    }

    #[test]
    fn firing_from_a_missing_player_or_a_bad_formula_is_an_error() {
        let game = three(Field::Disc, Frame::Map);
        assert_eq!(
            game.fire_from(1, 1, "1", false),
            Err(FireError::UnknownPlayer)
        );
        assert_eq!(
            game.fire_from(2, 0, "1", false),
            Err(FireError::UnknownPlayer)
        );
        assert_eq!(
            game.fire_param_from(0, 0, "t", "", false),
            Err(FireError::Parse(ParseError::UnexpectedEnd))
        );
        // x is not the disc variable; 1/(θ - π) is undefined at the shooter at (-8, 0)
        assert!(game.fire_from(0, 0, "x", false).is_err());
        assert_eq!(
            game.fire_from(0, 0, "1/(θ-pi)", false),
            Err(FireError::UndefinedAtShooter)
        );
    }

    #[test]
    fn random_obstacles_replace_the_old_ones_and_avoid_the_players() {
        let players = [player(-8., 0., 0), player(5., 0., 1)];
        for field in [Field::Xy, Field::Disc] {
            let players = players
                .iter()
                .map(|p| player(p.x / 2., p.y, p.team))
                .collect();
            let game = sandbox(field, Frame::Map, players, vec![obstacle(0., 0., 1.)]).unwrap();
            let random = game.with_random_obstacles(20, 0.2, 1.5, 7).unwrap();
            let arena = random.js_arena();
            assert_eq!(arena.obstacles().len(), 20);
            assert!(
                arena
                    .obstacles()
                    .iter()
                    .all(|o| !arena.collision_with_player(o))
            );
            assert!(arena.get_teams() == game.js_arena().get_teams());
            let again = game.with_random_obstacles(20, 0.2, 1.5, 7).unwrap();
            assert!(again.js_arena() == arena);
            assert_eq!(game.js_arena().obstacles().len(), 1);
        }
        let game = sandbox(Field::Xy, Frame::Map, vec![], vec![]).unwrap();
        assert_eq!(
            game.with_random_obstacles(5, 2., 1., 0).err(),
            Some(GameError::ObstacleSizeRange)
        );
        assert_eq!(
            game.with_random_obstacles(5, 0., 1., 0).err(),
            Some(GameError::NonPositiveSize)
        );
    }
}
