mod arena;
mod obstacle;
mod player;
mod team;

use rand::{rngs::SmallRng, SeedableRng};
use rand_distr::{Distribution, Normal};
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

enum Type {
    Player,
    Obstacle,
}

#[wasm_bindgen]
pub struct Game {
    teams: Vec<Team>,
    obstacles: Vec<Obstacle>,
    arena: Arena,
    rng: SmallRng,
}

#[wasm_bindgen]
impl Game {
    #[wasm_bindgen(constructor)]
    pub fn new(
        x_max: f64,
        y_max: f64,
        num_obstacles: usize,
        obstacle_size: f64,
        players_per_team: &[f64],
        player_radius: f64,
        seed: f64,
    ) -> Result<Game, JsValue> {
        utils::set_panic_hook();

        if x_max <= 0. || y_max <= 0. {
            return Err(JsValue::from_str(
                "x_max and y_max must have a positive value",
            ));
        }

        if obstacle_size <= 0. || player_radius <= 0. {
            return Err(JsValue::from_str(
                "Obstacle size and player radius must be a positive value",
            ));
        }

        let teams = Vec::with_capacity(players_per_team.len());
        let mut game = Game {
            teams,
            obstacles: Vec::with_capacity(num_obstacles),
            arena: Arena::new(2.0 * x_max, 2.0 * y_max),
            rng: SmallRng::seed_from_u64(seed as u64),
        };
        game.create_obstables(num_obstacles, obstacle_size);

        // May fail if the player radius is too big
        game.create_team(
            &players_per_team
                .iter()
                .map(|&e| e as usize)
                .collect::<Vec<usize>>(),
            player_radius,
        )?;

        Ok(game)
    }

    fn create_team(
        &mut self,
        players_per_team: &[usize],
        player_size: f64,
    ) -> Result<(), JsValue> {

        let areas = self.arena.area().partition(players_per_team.len() as u64);
        for (team_size, area) in players_per_team.iter().zip(areas.iter()) {
            let mut team = Team::new(area.clone());
            match team.add_players(*team_size, player_size, &self.arena, &mut self.rng) {
                Err(error) => return Err(JsValue::from_str(error.message())),
                _ => {}
            };
        }

        Ok(())
    }

    fn create_obstables(&mut self, num_obstacles: usize, max_obstacle_size: f64) {
        self.arena
            .add_obstacles(num_obstacles, max_obstacle_size, &mut self.rng);
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

        for (i, team) in self.teams.iter().enumerate() {
            team.draw(&canvas, &helper, i);
        }

        for obstacle in &self.obstacles {
            obstacle.draw(&canvas, &helper);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build() {
        let game = Game::new(20.0, 10.0, 2, 0.2, &[4.0, 4.0], 0.5, 0.0);
        game.unwrap();
    }
}
