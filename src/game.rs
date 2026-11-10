mod arena;
mod player;
mod shot;
mod team;

use std::fmt;

use rand::{rngs::SmallRng, SeedableRng};
use wasm_bindgen::prelude::*;

use crate::{formula::Formula, utils};

pub use self::arena::Arena;
pub use self::player::Player;
pub use self::shot::{FireError, Shot};
pub use self::team::Team;

const MAX_ITERS: usize = 100;

/// Shape of the playing field, chosen by the host.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Field {
    /// Rectangle from `-x_max` to `x_max` and `-y_max` to `y_max`, exactly two teams.
    Xy,
    /// Disc of radius `y_max` centred on the origin, two or more teams.
    Disc,
}

/// Where shot formulas are drawn from, chosen by the host (ADR 20).
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Frame {
    /// Map coordinates, offset so the curve passes through the shooter (like Graphwar).
    Map,
    /// The shooter's local frame, facing the centre (ADR 4, 5).
    Player,
}

/// True for finite values above zero; rejects NaN and infinity, which would panic inside `rand`.
fn is_positive(x: f64) -> bool {
    x.is_finite() && x > 0.
}

/// Why a game could not be created.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GameError {
    /// Fewer than two teams.
    TooFewTeams,
    /// A team without players could never take its turn.
    EmptyTeam,
    /// `Field::Xy` only supports exactly two teams.
    XyNeedsTwoTeams,
    /// `x_max` or `y_max` is not a finite positive number.
    NonPositiveExtent,
    /// `Field::Disc` needs `x_max == y_max`.
    DiscNotSquare,
    /// An obstacle size or the player radius is not a finite positive number.
    NonPositiveSize,
    /// The maximum obstacle size is smaller than the minimum.
    ObstacleSizeRange,
    /// On a disc the player radius must fit in the placement annulus `[R/2, R - radius]`.
    DiscPlayerTooLarge,
    /// No collision-free layout was found within the retry budget.
    NoValidLayout,
}

impl fmt::Display for GameError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            GameError::TooFewTeams => "There must be at least two teams",
            GameError::EmptyTeam => "Every team needs at least one player",
            GameError::XyNeedsTwoTeams => "The XY field requires exactly two teams",
            GameError::NonPositiveExtent => "x_max and y_max must have a positive value",
            GameError::DiscNotSquare => "The disc field requires x_max == y_max",
            GameError::NonPositiveSize => {
                "Obstacle size and player radius must be a positive value"
            }
            GameError::ObstacleSizeRange => {
                "The maximum obstacle size must be at least the minimum obstacle size"
            }
            GameError::DiscPlayerTooLarge => {
                "The player radius must be at most half the disc radius"
            }
            GameError::NoValidLayout => "Could not find a valid initial configuration",
        })
    }
}

impl From<FireError> for JsValue {
    fn from(e: FireError) -> JsValue {
        JsValue::from_str(&e.to_string())
    }
}

impl From<GameError> for JsValue {
    fn from(e: GameError) -> JsValue {
        JsValue::from_str(&e.to_string())
    }
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct Options {
    num_obstacles: usize,
    min_obstacle_size: f64,
    max_obstacle_size: f64,
    players_per_team: Vec<usize>,
    player_radius: f64,
    seed: u64,
}

#[wasm_bindgen]
#[derive(Clone)]
/// Represents a game instance.
pub struct Game {
    arena: Arena,
    frame: Frame,
    ops: Options,
    current_team: usize,
}

#[wasm_bindgen]
/// Methods available in the WebAssembly module.
impl Game {
    /// Creates a new game instance on the given `field`, with shots drawn in `frame` (ADR 20).
    /// The arena goes from -`x_max` to `x_max` and -`y_max` to `y_max` (for a disc, `x_max` must
    /// equal `y_max`, the disc radius) and contains `num_obstacles` obstacles with a size between
    /// `min_obstacle_size` and `max_obstacle_size`. Each team has a number of players defined by
    /// `players_per_team` with a radius of `player_radius`. The number of teams is inferred by the
    /// length of `players_per_team`. The `seed` is used to generate the initial positions of the
    /// obstacles and players.
    #[wasm_bindgen(constructor)]
    pub fn new(
        field: Field,
        frame: Frame,
        x_max: f64,
        y_max: f64,
        num_obstacles: usize,
        min_obstacle_size: f64,
        max_obstacle_size: f64,
        players_per_team: &[usize],
        player_radius: f64,
        seed: u64,
    ) -> Result<Game, GameError> {
        utils::set_panic_hook();

        if players_per_team.len() < 2 {
            return Err(GameError::TooFewTeams);
        }

        if players_per_team.contains(&0) {
            return Err(GameError::EmptyTeam);
        }

        if field == Field::Xy && players_per_team.len() != 2 {
            return Err(GameError::XyNeedsTwoTeams);
        }

        if !is_positive(x_max) || !is_positive(y_max) {
            return Err(GameError::NonPositiveExtent);
        }

        if field == Field::Disc && x_max != y_max {
            return Err(GameError::DiscNotSquare);
        }

        if !is_positive(min_obstacle_size)
            || !is_positive(max_obstacle_size)
            || !is_positive(player_radius)
        {
            return Err(GameError::NonPositiveSize);
        }

        if min_obstacle_size > max_obstacle_size {
            return Err(GameError::ObstacleSizeRange);
        }

        if field == Field::Disc && player_radius > y_max / 2. {
            return Err(GameError::DiscPlayerTooLarge);
        }

        let mut game = Game {
            arena: Arena::new(field, x_max, y_max),
            frame,
            ops: Options {
                num_obstacles,
                min_obstacle_size,
                max_obstacle_size,
                players_per_team: players_per_team.iter().cloned().collect(),
                player_radius,
                seed,
            },
            current_team: 0,
        };

        game.init()?;

        Ok(game)
    }

    #[wasm_bindgen(js_name = "arena")]
    pub fn js_arena(&self) -> Arena {
        self.arena.clone()
    }

    #[wasm_bindgen(js_name = "clone")]
    pub fn js_clone(&self) -> Game {
        self.clone()
    }

    pub fn get_current_team_idx(&self) -> usize {
        self.current_team
    }

    pub fn get_current_formula(&self) -> String {
        self.get_current_player()
            .map(|p| p.formula().into())
            .unwrap_or_default()
    }

    /// Fires `expr` from the current player: `y = f(x)` on the XY field, `r = f(θ)` on the disc,
    /// in the game's frame (ADR 20). On the disc `clockwise` sweeps θ downward (map frame) or
    /// mirrors the shot across the shooter-to-centre axis (player frame); XY ignores it.
    /// On an error nothing changes and the turn is not consumed.
    pub fn fire(&mut self, expr: &str, clockwise: bool) -> Result<Shot, FireError> {
        let var = match self.arena.field() {
            Field::Xy => "x",
            Field::Disc => "θ",
        };
        let f = Formula::parse(expr, var)?;
        let frame = self.frame;
        self.shoot(|arena, shooter| shot::explicit(arena, shooter, &f, frame, clockwise))
    }

    /// Fires `a`, `b` from the current player: `x(t), y(t)` on the XY field, `r(t), θ(t)` on the
    /// disc. `clockwise` as in `fire`. On an error nothing changes and the turn is not consumed.
    pub fn fire_param(&mut self, a: &str, b: &str, clockwise: bool) -> Result<Shot, FireError> {
        let (a, b) = (Formula::parse(a, "t")?, Formula::parse(b, "t")?);
        let frame = self.frame;
        self.shoot(|arena, shooter| shot::parametric(arena, shooter, &a, &b, frame, clockwise))
    }

    /// Fails exactly when `fire(expr)` would, without changing the game.
    pub fn check(&self, expr: &str) -> Result<(), FireError> {
        self.clone().fire(expr, false).map(|_| ())
    }

    /// Fails exactly when `fire_param(a, b)` would, without changing the game.
    pub fn check_param(&self, a: &str, b: &str) -> Result<(), FireError> {
        self.clone().fire_param(a, b, false).map(|_| ())
    }

    /// Passes the turn without shooting (timeout, or a remote formula that failed to parse).
    pub fn skip_turn(&mut self) {
        self.end_turn();
    }

    /// Removes a team from the game, e.g. because its peer left. Does nothing for an unknown
    /// index. If it was the current team the turn passes on; no turn is otherwise consumed.
    pub fn eliminate_team(&mut self, idx: usize) {
        let Some(team) = self.arena.get_teams_mut().get_mut(idx) else {
            return;
        };
        team.eliminate();
        if idx == self.current_team {
            self.next_team();
        }
    }

    /// The only team with living players, or `undefined` while several (or none) remain.
    pub fn winner(&self) -> Option<usize> {
        let mut alive = self
            .arena
            .get_teams()
            .iter()
            .enumerate()
            .filter(|(_, t)| t.is_alive())
            .map(|(i, _)| i);
        match (alive.next(), alive.next()) {
            (Some(i), None) => Some(i),
            _ => None,
        }
    }
}

/// Methods available only in the rust part of the code.
impl Game {
    // // Vertical range is the same for both sides
    // let p_range_y = Range::new(self.arena.bottom(), self.arena.top());

    pub fn init(&mut self) -> Result<(), GameError> {
        let mut rng: SmallRng = SeedableRng::seed_from_u64(self.ops.seed);

        for _ in 1..MAX_ITERS {
            // Clear previous data first, just in case
            self.arena.clear();

            match self.arena.add_obstacles(
                self.ops.num_obstacles,
                self.ops.min_obstacle_size,
                self.ops.max_obstacle_size,
                &mut rng,
            ) {
                Ok(_) => {}
                Err(_) => continue,
            };

            match self
                .arena
                .add_teams(&self.ops.players_per_team, self.ops.player_radius, &mut rng)
            {
                Ok(_) => return Ok(()),
                Err(_) => continue,
            };
        }

        Err(GameError::NoValidLayout)
    }

    /// Runs `trace` for the current player and ends the turn unless it fails. With no living
    /// player to shoot (everyone eliminated) the shot is empty and nothing changes.
    fn shoot(
        &mut self,
        trace: impl FnOnce(&mut Arena, (usize, usize)) -> Result<Shot, FireError>,
    ) -> Result<Shot, FireError> {
        let team = &self.arena.get_teams()[self.current_team];
        if team.get_current_player().is_none() {
            return Ok(Shot { points: Vec::new() });
        }
        let shooter = (self.current_team, team.current_index());
        let shot = trace(&mut self.arena, shooter)?;
        self.end_turn();
        Ok(shot)
    }

    /// The shooting team rotates to its next living player, then the turn passes to the next team
    /// with living players (ADR 4).
    fn end_turn(&mut self) {
        self.arena.get_teams_mut()[self.current_team].next_player();
        self.next_team();
    }

    pub fn next_team(&mut self) {
        let teams = self.arena.get_teams_mut();
        assert!(teams.len() > 0);

        for i in 1..teams.len() {
            let idx = (self.current_team + i) % teams.len();

            if teams[idx].is_alive() {
                // Its current player may have died since its last turn
                if teams[idx].get_current_player().is_none() {
                    teams[idx].next_player();
                }
                self.current_team = idx;
                return;
            }
        }
    }

    fn get_current_player(&self) -> Option<&Player> {
        self.arena.get_teams()[self.current_team].get_current_player()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::formula::ParseError;

    #[test]
    fn test_build() {
        let game = Game::new(
            Field::Xy,
            Frame::Map,
            20.0,
            10.0,
            5,
            0.2,
            2.0,
            &[4, 4],
            1.0,
            0,
        );
        assert!(game.is_ok());
    }

    fn disc(teams: &[usize], seed: u64) -> Result<Game, GameError> {
        Game::new(
            Field::Disc,
            Frame::Map,
            10.0,
            10.0,
            8,
            0.2,
            1.0,
            teams,
            0.3,
            seed,
        )
    }

    #[test]
    fn xy_rejects_three_teams() {
        let game = Game::new(
            Field::Xy,
            Frame::Map,
            20.0,
            10.0,
            5,
            0.2,
            2.0,
            &[2, 2, 2],
            1.0,
            0,
        );
        assert_eq!(game.err(), Some(GameError::XyNeedsTwoTeams));
    }

    #[test]
    fn disc_requires_square_extent() {
        let game = Game::new(
            Field::Disc,
            Frame::Map,
            20.0,
            10.0,
            5,
            0.2,
            1.0,
            &[2, 2],
            0.3,
            0,
        );
        assert_eq!(game.err(), Some(GameError::DiscNotSquare));
        assert!(disc(&[2, 2], 0).is_ok());
    }

    #[test]
    fn disc_rejects_oversized_player() {
        let game = Game::new(
            Field::Disc,
            Frame::Map,
            10.0,
            10.0,
            5,
            0.2,
            1.0,
            &[2, 2],
            6.0,
            0,
        );
        assert_eq!(game.err(), Some(GameError::DiscPlayerTooLarge));
    }

    #[test]
    fn non_finite_inputs_are_rejected() {
        let new = |field, extent: f64, min: f64, max: f64, radius: f64| {
            Game::new(
                field,
                Frame::Map,
                extent,
                extent,
                5,
                min,
                max,
                &[2, 2],
                radius,
                0,
            )
            .err()
        };
        for bad in [f64::NAN, f64::INFINITY] {
            assert_eq!(
                new(Field::Disc, bad, 0.2, 1.0, 0.3),
                Some(GameError::NonPositiveExtent)
            );
            assert_eq!(
                new(Field::Xy, bad, 0.2, 1.0, 0.3),
                Some(GameError::NonPositiveExtent)
            );
            assert_eq!(
                new(Field::Disc, 10.0, bad, 1.0, 0.3),
                Some(GameError::NonPositiveSize)
            );
            assert_eq!(
                new(Field::Disc, 10.0, 0.2, bad, 0.3),
                Some(GameError::NonPositiveSize)
            );
            assert_eq!(
                new(Field::Disc, 10.0, 0.2, 1.0, bad),
                Some(GameError::NonPositiveSize)
            );
        }
    }

    #[test]
    fn disc_obstacles_fit_inside() {
        for seed in 0..20 {
            let arena = disc(&[2, 2, 2], seed).unwrap().js_arena();
            for o in arena.obstacles() {
                let pos = o.pos();
                assert!(pos.x.hypot(pos.y) + o.radius() <= 10.0 + 1e-9);
            }
        }
    }

    #[test]
    fn disc_players_of_different_teams_do_not_overlap() {
        for seed in 0..20 {
            let Ok(game) = Game::new(
                Field::Disc,
                Frame::Map,
                10.0,
                10.0,
                0,
                0.2,
                1.0,
                &[6; 6],
                1.0,
                seed,
            ) else {
                continue;
            };
            let arena = game.js_arena();
            let teams = arena.get_teams();
            for (i, a) in teams.iter().enumerate() {
                for b in &teams[i + 1..] {
                    for (p, q) in a
                        .players()
                        .iter()
                        .flat_map(|p| b.players().iter().map(move |q| (p, q)))
                    {
                        assert!(!p.shape().collision_circle(q.shape()));
                    }
                }
            }
        }
    }

    #[test]
    fn disc_entities_inside_and_in_sector() {
        let teams = [3, 2, 4, 3, 1];
        for seed in 0..20 {
            let arena = disc(&teams, seed).unwrap().js_arena();
            let sector = std::f64::consts::TAU / teams.len() as f64;

            for o in arena.obstacles() {
                assert!(arena.contains(o.pos()));
            }

            for (i, team) in arena.get_teams().iter().enumerate() {
                for p in team.players() {
                    let (pos, radius) = (p.shape().pos(), p.shape().radius());
                    let r = pos.x.hypot(pos.y);
                    assert!(r >= 5.0 - 1e-9 && r <= 10.0 - radius + 1e-9, "r = {r}");

                    // Signed angular distance to the sector centre, in [-pi, pi)
                    let delta = (pos.y.atan2(pos.x) - sector * i as f64 + std::f64::consts::PI)
                        .rem_euclid(std::f64::consts::TAU)
                        - std::f64::consts::PI;
                    assert!(delta.abs() <= sector / 2. + 1e-9, "delta = {delta}");
                }
            }
        }
    }

    #[test]
    fn same_seed_same_arena() {
        for (a, b) in [(7, 7), (7, 8)] {
            let xy = |seed| {
                Game::new(
                    Field::Xy,
                    Frame::Map,
                    20.0,
                    10.0,
                    5,
                    0.2,
                    2.0,
                    &[4, 4],
                    1.0,
                    seed,
                )
            };
            assert_eq!(
                xy(a).unwrap().js_arena() == xy(b).unwrap().js_arena(),
                a == b
            );
            assert_eq!(
                disc(&[2, 2, 2], a).unwrap().js_arena() == disc(&[2, 2, 2], b).unwrap().js_arena(),
                a == b
            );
        }
    }

    /// Game on a hand-made arena; `teams` lists the player positions of each team.
    fn game_with(field: Field, extent: (f64, f64), teams: &[&[(f64, f64)]]) -> Game {
        let teams = teams.iter().map(|t| Team::from_positions(t, 0.3)).collect();
        Game {
            arena: Arena::from_parts(field, extent.0, extent.1, vec![], teams),
            frame: Frame::Map,
            ops: Options {
                num_obstacles: 0,
                min_obstacle_size: 0.2,
                max_obstacle_size: 1.,
                players_per_team: vec![],
                player_radius: 0.3,
                seed: 0,
            },
            current_team: 0,
        }
    }

    /// Three teams on a disc; team 0 at (8, 0) shoots toward team 1's first player.
    fn three_teams() -> Game {
        game_with(
            Field::Disc,
            (10., 10.),
            &[&[(8., 0.)], &[(-5., 0.), (-4., 6.)], &[(-4., -6.)]],
        )
    }

    #[test]
    fn parse_error_leaves_state_unchanged() {
        let mut game = three_teams();
        let before = game.js_arena();
        assert_eq!(
            game.fire("1+", false).err(),
            Some(FireError::Parse(ParseError::UnexpectedEnd))
        );
        assert_eq!(
            game.fire_param("t", "foo(t)", false).err(),
            Some(FireError::Parse(ParseError::UnknownName("foo".into())))
        );
        // x is not the disc variable
        assert!(game.fire("x", false).is_err());
        assert!(game.js_arena() == before);
        assert_eq!(game.get_current_team_idx(), 0);
    }

    #[test]
    fn fire_kills_and_passes_the_turn() {
        let mut game = three_teams();
        let shot = game.fire_param("-t", "0", false).unwrap();
        assert!(!shot.points.is_empty());
        assert_eq!(
            game.arena.alive(),
            vec![vec![true], vec![false, true], vec![true]]
        );
        assert_eq!(game.get_current_team_idx(), 1);
        assert_eq!(game.arena.get_teams()[1].current_index(), 1);
    }

    #[test]
    fn turns_skip_dead_teams_and_players() {
        let mut game = game_with(
            Field::Disc,
            (10., 10.),
            &[
                &[(8., 0.), (7., 1.)],
                &[(-8., 0.)],
                &[(0., 8.), (0., 7.), (0., 6.)],
            ],
        );
        game.arena.get_teams_mut()[1].eliminate();
        game.arena.get_teams_mut()[2]
            .get_current_player_mut()
            .unwrap()
            .kill();

        // Team 1 is dead and team 2's first player is dead
        let mut seen = Vec::new();
        for _ in 0..6 {
            game.skip_turn();
            let team = game.get_current_team_idx();
            let player = game.arena.get_teams()[team].get_current_player().unwrap();
            assert!(player.alive());
            seen.push((team, game.arena.get_teams()[team].current_index()));
        }
        assert_eq!(seen, [(2, 1), (0, 1), (2, 2), (0, 0), (2, 1), (0, 1)]);
    }

    #[test]
    fn nothing_alive_does_not_panic() {
        let mut game = three_teams();
        (0..3).for_each(|i| game.eliminate_team(i));
        assert!(game.fire("theta", false).unwrap().points.is_empty());
        game.skip_turn();
        assert_eq!(game.get_current_formula(), "");
        assert_eq!(game.winner(), None);
    }

    #[test]
    fn eliminating_the_current_team_passes_the_turn() {
        let mut game = three_teams();
        game.eliminate_team(0);
        assert_eq!(game.get_current_team_idx(), 1);
        game.eliminate_team(7);
        assert_eq!(game.get_current_team_idx(), 1);
    }

    #[test]
    fn winner_is_the_last_team_standing() {
        let mut game = three_teams();
        assert_eq!(game.winner(), None);
        game.eliminate_team(1);
        assert_eq!(game.winner(), None);
        game.eliminate_team(2);
        assert_eq!(game.winner(), Some(0));
        game.eliminate_team(0);
        assert_eq!(game.winner(), None);
    }

    #[test]
    fn undefined_start_is_an_error_and_changes_nothing() {
        let mut game = three_teams();
        let before = game.js_arena();
        for (a, b) in [("1/t", "0"), ("t", "ln(t)")] {
            assert_eq!(
                game.fire_param(a, b, false).err(),
                Some(FireError::UndefinedAtShooter)
            );
            assert_eq!(game.check_param(a, b), Err(FireError::UndefinedAtShooter));
        }
        for expr in ["1/theta", "ln(theta)"] {
            assert_eq!(
                game.fire(expr, false).err(),
                Some(FireError::UndefinedAtShooter)
            );
            assert_eq!(game.check(expr), Err(FireError::UndefinedAtShooter));
        }
        let xy = game_with(Field::Xy, (10., 5.), &[&[(-8., 0.)], &[(8., 0.)]]);
        // Undefined at the shooter's x = -8
        for expr in ["1/(x+8)", "(x+8)^-1", "sin(x+8)/(x+8)"] {
            assert_eq!(
                xy.clone().fire(expr, false).err(),
                Some(FireError::UndefinedAtShooter)
            );
            assert_eq!(xy.check(expr), Err(FireError::UndefinedAtShooter));
        }
        assert!(game.js_arena() == before);
        assert_eq!(game.get_current_team_idx(), 0);
    }

    #[test]
    fn check_mirrors_fire_without_changing_state() {
        let game = three_teams();
        let before = game.js_arena();
        assert_eq!(
            game.check("1+"),
            Err(FireError::Parse(ParseError::UnexpectedEnd))
        );
        assert_eq!(game.check("theta"), Ok(()));
        assert_eq!(game.check_param("t", "0"), Ok(()));
        assert!(game.check_param("t", "").is_err());
        assert!(game.js_arena() == before);
        assert_eq!(game.get_current_team_idx(), 0);
    }

    #[test]
    fn a_kill_by_fire_can_decide_the_winner() {
        let mut game = game_with(Field::Disc, (10., 10.), &[&[(8., 0.)], &[(-5., 0.)]]);
        assert_eq!(game.winner(), None);
        game.fire_param("-t", "0", false).unwrap();
        assert_eq!(game.winner(), Some(0));
    }

    #[test]
    fn empty_teams_are_rejected() {
        let game = Game::new(
            Field::Disc,
            Frame::Map,
            10.0,
            10.0,
            0,
            0.2,
            1.0,
            &[2, 0, 2],
            0.3,
            0,
        );
        assert_eq!(game.err(), Some(GameError::EmptyTeam));
    }

    #[test]
    fn clockwise_shot_can_hit_what_counter_clockwise_misses() {
        // r = θ from (8, 0) passes polar (9, 1) counter-clockwise and (7, -1) clockwise;
        // r = -t/2, θ = t/4 passes polar (6, 1) counter-clockwise and (6, -1) clockwise
        for clockwise in [false, true] {
            for (x, y, param) in [
                (4.863, 7.573, false),
                (3.782, -5.890, false),
                (3.242, 5.049, true),
                (3.242, -5.049, true),
            ] {
                let mut game = game_with(Field::Disc, (10., 10.), &[&[(8., 0.)], &[(x, y)]]);
                if param {
                    game.fire_param("-t/2", "t/4", clockwise).unwrap();
                } else {
                    game.fire("theta", clockwise).unwrap();
                }
                assert_eq!(game.arena.alive()[1][0], (y > 0.) == clockwise);
            }
        }
    }

    #[test]
    fn player_frame_clockwise_shot_can_hit_what_counter_clockwise_misses() {
        // In the shooter's frame r = θ from (8, 0) passes (8, -π/2) counter-clockwise and
        // (8, π/2) clockwise; r = t, θ = 0.5 passes (4.49, -1.92) counter-clockwise and
        // (4.49, 1.92) clockwise
        for clockwise in [false, true] {
            for (x, y, param) in [
                (8., 1.5, false),
                (8., -1.5, false),
                (4.49, 1.92, true),
                (4.49, -1.92, true),
            ] {
                let mut game = game_with(Field::Disc, (10., 10.), &[&[(8., 0.)], &[(x, y)]]);
                game.frame = Frame::Player;
                if param {
                    game.fire_param("t", "0.5", clockwise).unwrap();
                } else {
                    game.fire("theta", clockwise).unwrap();
                }
                assert_eq!(game.arena.alive()[1][0], (y < 0.) == clockwise);
            }
        }
    }
}
