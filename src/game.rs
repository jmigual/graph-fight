mod arena;
mod obstacle;
mod player;
mod team;

use rand::{rngs::SmallRng, Rng, SeedableRng};
use wasm_bindgen::prelude::*;

use crate::geometry::*;
use crate::utils;

pub use self::arena::Arena;
pub use self::obstacle::Obstacle;
pub use self::player::Player;
pub use self::team::Team;

mod style {
    pub mod colour {
        pub const BACKGROUND: &str = "#FFF";
    }
}

const MAX_ITERS: usize = 100;

#[wasm_bindgen]
pub struct Options {
    num_obstacles: usize,
    min_obstacle_size: f64,
    max_obstacle_size: f64,
    players_per_team: Vec<usize>,
    player_size: f64,
    seed: u64,
}

#[wasm_bindgen]
pub struct Game {
    arena: Arena,
    ops: Options,
}

#[wasm_bindgen]
impl Game {
    #[wasm_bindgen(constructor)]
    pub fn new(
        h_max: f64,
        v_max: f64,
        num_obstacles: f64,
        min_obstacle_size: f64,
        max_obstacle_size: f64,
        players_per_team: &[usize],
        player_size: f64,
        seed: f64,
    ) -> Game {
        utils::set_panic_hook();

        assert!(
            h_max > 0.0 && v_max > 0.0,
            "x_max and y_max must have a positive value"
        );
        assert!(
            min_obstacle_size > 0.0 && player_size > 0.0,
            "Min obstacle size and player radius must be a positive value"
        );
        assert!(
            min_obstacle_size < max_obstacle_size,
            "The maximum obstacle size must be larger than the minimum obstacle size"
        );

        Game {
            arena: Arena::new(2.0 * h_max, 2.0 * v_max),
            ops: Options {
                num_obstacles: num_obstacles as usize,
                min_obstacle_size,
                max_obstacle_size,
                players_per_team: players_per_team.iter().cloned().collect(),
                player_size,
                seed: seed as u64,
            },
        }
    }

    pub fn init(&mut self) -> Result<(), JsValue> {
        let mut rng: SmallRng = SeedableRng::seed_from_u64(self.ops.seed);

        for _ in 1..MAX_ITERS {
            // Clear previous data first, just in case
            self.arena.clear();

            match self
                .arena
                .add_teams(&self.ops.players_per_team, self.ops.player_size, &mut rng)
            {
                Err(error) => return Err(JsValue::from(error.message())),
                _ => (),
            }

            match self.arena.add_obstacles(
                self.ops.num_obstacles,
                self.ops.min_obstacle_size,
                self.ops.max_obstacle_size,
                &mut rng,
            ) {
                Err(error) => return Err(JsValue::from(error.message())),
                _ => (),
            }
        }

        Ok(())
    }

    pub fn draw(&self, canvas: web_sys::HtmlCanvasElement) {
        let helper = math::CanvasHelper::new(
            canvas.width() as f64,
            canvas.height() as f64,
            self.arena.area().width(),
            self.arena.area().height(),
        );

        // Draw background
        let ctx = utils::ctx_from_canvas(&canvas);

        ctx.set_fill_style(&JsValue::from_str(style::colour::BACKGROUND));
        ctx.fill_rect(0.0, 0.0, helper.c_width(), helper.c_height());
        ctx.stroke();

        self.arena.draw(&canvas, &helper);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build() {
        let mut game = Game::new(20.0, 10.0, 2.0, 0.2, 2.0, &[4, 4], 0.5, 0.0);
        game.init().unwrap();
    }
}
