mod arena;
mod player;
mod team;

use rand::{rngs::SmallRng, SeedableRng};
use wasm_bindgen::prelude::*;

use crate::utils;

pub use self::arena::Arena;
pub use self::player::Player;
pub use self::team::Team;

const MAX_ITERS: usize = 100;

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
    /// Creates a new game instance with an arena that goes from -`x_max` to `x_max` and -`y_max`
    /// to `y_max` and contains `num_obstacles` obstacles with a size between
    /// `min_obstacle_size` and `max_obstacle_size`. Each team has a number of players
    /// defined by `players_per_team` with a radius of `player_radius`. The number of teams is
    /// inferred by the length of `players_per_team`. The `seed` is used to generate the initial
    /// positions of the obstacles and players.
    #[wasm_bindgen(constructor)]
    pub fn new(
        x_max: f64,
        y_max: f64,
        num_obstacles: usize,
        min_obstacle_size: f64,
        max_obstacle_size: f64,
        players_per_team: &[usize],
        player_radius: f64,
        seed: u64,
    ) -> Result<Game, String> {
        utils::set_panic_hook();

        if players_per_team.len() < 2 {
            return Err("There must be at least two teams".into());
        }

        if x_max <= 0. || y_max <= 0. {
            return Err("x_max and y_max must have a positive value".into());
        }

        if min_obstacle_size <= 0. || player_radius <= 0. {
            return Err("Obstacle size and player radius must be a positive value".into());
        }

        if min_obstacle_size > max_obstacle_size {
            return Err(
                "The maximum obstacle size must be at least the minimum obstacle size".into(),
            );
        }

        let mut game = Game {
            arena: Arena::new(x_max, y_max),
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

    pub fn init(&mut self) -> Result<(), String> {
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

        Err("Could not find a valid initial configuration".into())
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
        let game = Game::new(20.0, 10.0, 5, 0.2, 2.0, &[4, 4], 1.0, 0);
        assert!(game.is_ok());
    }
}
