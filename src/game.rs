mod arena;
mod player;
mod shot;
mod team;

use std::fmt;

use rand::{rngs::SmallRng, SeedableRng};
use wasm_bindgen::prelude::*;

use crate::utils;

pub use self::arena::Arena;
pub use self::player::Player;
pub use self::shot::Shot;
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

/// True for finite values above zero; rejects NaN and infinity, which would panic inside `rand`.
fn is_positive(x: f64) -> bool {
    x.is_finite() && x > 0.
}

/// Why a game could not be created.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GameError {
    /// Fewer than two teams.
    TooFewTeams,
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
    ops: Options,
    current_team: usize,
}

#[wasm_bindgen]
/// Methods available in the WebAssembly module.
impl Game {
    /// Creates a new game instance on the given `field`. The arena goes from -`x_max` to `x_max`
    /// and -`y_max` to `y_max` (for a disc, `x_max` must equal `y_max`, the disc radius) and
    /// contains `num_obstacles` obstacles with a size between `min_obstacle_size` and
    /// `max_obstacle_size`. Each team has a number of players
    /// defined by `players_per_team` with a radius of `player_radius`. The number of teams is
    /// inferred by the length of `players_per_team`. The `seed` is used to generate the initial
    /// positions of the obstacles and players.
    #[wasm_bindgen(constructor)]
    pub fn new(
        field: Field,
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
        self.get_current_player().formula().into()
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

    pub fn shoot(&mut self, formula: &str) -> Result<(), JsValue> {
        // Check if formula is valid

        let player = self.get_current_player_mut();
        player.set_formula(formula.into());

        Ok(())
    }

    pub fn next_team(&mut self) {
        let teams = self.arena.get_teams();
        assert!(teams.len() > 0);

        for i in 1..teams.len() {
            let idx = (self.current_team + i) % teams.len();

            if teams[idx].is_alive() {
                self.current_team = idx;
                return;
            }
        }
    }

    fn get_current_player_mut(&mut self) -> &mut Player {
        self.arena.get_teams_mut()[self.current_team]
            .get_current_player_mut()
            .unwrap()
    }

    fn get_current_player(&self) -> &Player {
        self.arena.get_teams()[self.current_team]
            .get_current_player()
            .unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build() {
        let game = Game::new(Field::Xy, 20.0, 10.0, 5, 0.2, 2.0, &[4, 4], 1.0, 0);
        assert!(game.is_ok());
    }

    fn disc(teams: &[usize], seed: u64) -> Result<Game, GameError> {
        Game::new(Field::Disc, 10.0, 10.0, 8, 0.2, 1.0, teams, 0.3, seed)
    }

    #[test]
    fn xy_rejects_three_teams() {
        let game = Game::new(Field::Xy, 20.0, 10.0, 5, 0.2, 2.0, &[2, 2, 2], 1.0, 0);
        assert_eq!(game.err(), Some(GameError::XyNeedsTwoTeams));
    }

    #[test]
    fn disc_requires_square_extent() {
        let game = Game::new(Field::Disc, 20.0, 10.0, 5, 0.2, 1.0, &[2, 2], 0.3, 0);
        assert_eq!(game.err(), Some(GameError::DiscNotSquare));
        assert!(disc(&[2, 2], 0).is_ok());
    }

    #[test]
    fn disc_rejects_oversized_player() {
        let game = Game::new(Field::Disc, 10.0, 10.0, 5, 0.2, 1.0, &[2, 2], 6.0, 0);
        assert_eq!(game.err(), Some(GameError::DiscPlayerTooLarge));
    }

    #[test]
    fn non_finite_inputs_are_rejected() {
        let new = |field, extent: f64, min: f64, max: f64, radius: f64| {
            Game::new(field, extent, extent, 5, min, max, &[2, 2], radius, 0).err()
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
            let Ok(game) = Game::new(Field::Disc, 10.0, 10.0, 0, 0.2, 1.0, &[6; 6], 1.0, seed)
            else {
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
            let xy = |seed| Game::new(Field::Xy, 20.0, 10.0, 5, 0.2, 2.0, &[4, 4], 1.0, seed);
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
}
