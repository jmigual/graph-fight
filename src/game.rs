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

#[wasm_bindgen]
pub struct Options {
    h_max: f64,
    v_max: f64,
    num_obstacles: usize,
    min_obstacle_size: f64,
    max_obstacle_size: f64,
    players_per_team: Vec<usize>,
    player_size: f64,
    seed: u64,
}

#[wasm_bindgen]
impl Options {
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
    ) {
    }
}

#[wasm_bindgen]
pub struct Game {
    teams: Vec<Team>,
    arena: Arena,
    ops: Options,
}

#[wasm_bindgen]
impl Game {
    #[wasm_bindgen(constructor)]
    pub fn new(ops: Options) -> Game {
        utils::set_panic_hook();

        assert!(
            ops.h_max > 0.0 && ops.v_max > 0.0,
            "x_max and y_max must have a positive value"
        );
        assert!(
            ops.min_obstacle_size > 0.0 && ops.player_size > 0.0,
            "Min obstacle size and player radius must be a positive value"
        );
        assert!(
            ops.min_obstacle_size < ops.max_obstacle_size,
            "The maximum obstacle size must be larger than the minimum obstacle size"
        );

        let teams = Vec::with_capacity(ops.players_per_team.len());

        Game {
            teams,
            arena: Arena::new(2.0 * ops.h_max, 2.0 * ops.v_max),
            ops,
        }
    }

    pub fn init(&mut self) -> Result<(), JsValue> {
        // Clear previous data first, just in case
        self.teams.clear();
        self.arena = Arena::new(2.0 * self.ops.h_max, 2.0 * self.ops.v_max);

        let mut rng: SmallRng = SeedableRng::seed_from_u64(self.ops.seed);
        self.create_team(&mut rng)?;

        Ok(())
    }

    fn create_team<R: Rng + ?Sized>(&mut self, rng: &mut R) -> Result<(), JsValue> {
        let areas = self
            .arena
            .area()
            .partition(self.ops.players_per_team.len() as u64);

        for (team_size, area) in self.ops.players_per_team.iter().zip(areas.iter()) {
            let mut team = Team::new(area.clone());
            match team.add_players(*team_size, self.ops.player_size, &self.arena, rng) {
                Err(error) => return Err(JsValue::from_str(error.message())),
                _ => {}
            };
            self.teams.push(team);
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

        for team in self.teams.iter() {
            team.draw_area(&canvas, &helper);
        }

        for (i, team) in self.teams.iter().enumerate() {
            team.draw(&canvas, &helper, i);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build() {
        // let game = Game::new(20.0, 10.0, 2, 0.2, 2.0, &[4.0, 4.0], 0.5, 0.0);
        // game.init(0).unwrap();
    }
}
