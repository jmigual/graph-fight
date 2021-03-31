mod player;

use wasm_bindgen::prelude::*;

use crate::geometry::*;
use crate::utils;

pub use self::player::*;

#[wasm_bindgen]
pub struct Game {
    team_a: Vec<Player>,
    team_b: Vec<Player>,
    obstacles: Vec<Obstacle>,
    x_max: f64,
    y_max: f64,
}

#[wasm_bindgen]
impl Game {
    #[wasm_bindgen(constructor)]
    pub fn new(
        x_max: f64,
        y_max: f64,
        num_obstacles: usize,
        obstacle_size: f64,
        num_players_a: usize,
        num_players_b: usize,
        player_radius: f64,
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

        let mut game = Game {
            team_a: Vec::with_capacity(num_players_a),
            team_b: Vec::with_capacity(num_players_b),
            obstacles: Vec::with_capacity(num_obstacles),
            x_max,
            y_max,
        };

        // Vertical range is the same for both sides
        let p_range_y = Range::new(-y_max, y_max);

        // Player A goes on the left side
        let p_a_range_x = Range::new(-x_max, 0.);
        for _ in 0..num_players_a {
            let shape = match game.find_random_pos(&p_a_range_x, &p_range_y, player_radius) {
                Ok(p) => p,
                Err(error) => return Err(JsValue::from_str(error.message())),
            };

            let new_player = Player::from_circle(shape);
            game.team_a.push(new_player);
        }

        // Player B goes on the right side
        let p_b_range_x = Range::new(0., x_max);
        for _ in 0..num_players_b {
            let shape = match game.find_random_pos(&p_b_range_x, &p_range_y, player_radius) {
                Ok(p) => p,
                Err(error) => return Err(JsValue::from_str(error.message())),
            };

            let new_player = Player::from_circle(shape);
            game.team_b.push(new_player);
        }

        // Before placing an obstacle check that

        for _ in 0..num_obstacles {}

        Ok(game)
    }

    fn is_valid_pos(&self, shape: &Circle) -> bool {
        let f = |p: &Player| p.shape().collision(shape);

        if !self.team_a.iter().all(f) {
            return false;
        }

        if !self.team_b.iter().all(f) {
            return false;
        }

        let f = |p: &Obstacle| p.shape().collision(shape);

        if !self.obstacles.iter().all(f) {
            return false;
        }

        true
    }

    fn find_random_pos(
        &self,
        x_range: &Range<f64>,
        y_range: &Range<f64>,
        radius: f64,
    ) -> Result<Circle, utils::NotFoundError> {
        for _ in 0..100 {
            let pos = Point::random(&x_range, &y_range);
            let shape = Circle::new(pos, radius);

            if self.is_valid_pos(&shape) {
                return Ok(shape);
            }
        }
        Err(utils::NotFoundError::new("No valid position found"))
    }

    pub fn draw(canvas: web_sys::HtmlCanvasElement) {

        

    }
}
