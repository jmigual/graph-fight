mod player;

use wasm_bindgen::prelude::*;

use crate::geometry::*;
use crate::utils;

pub use self::player::*;

mod style {
    pub mod colour {
        pub const BACKGROUND: &str = "#FFF";
    }
}

#[wasm_bindgen]
pub struct Game {
    team_a: Vec<Player>,
    team_b: Vec<Player>,
    obstacles: Vec<Obstacle>,
    arena: Rectangle
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
            arena: Rectangle::new((0.0, 0.0).into(), x_max, y_max)
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
        let f = |p: &Player| !p.shape().collision_circle(shape);


        // Collision with players from team A
        if !self.team_a.iter().all(f) {
            return false;
        }

        // Collision with players from team B
        if !self.team_b.iter().all(f) {
            return false;
        }

        let f = |p: &Obstacle| p.shape().collision_circle(shape);

        // Collision with obstacles
        if !self.obstacles.iter().all(f) {
            return false;
        }
        true

        // Collision with walls
        // ((shape.pos.x - shape.radius()) > -self.x_max) && ((shape.pos.x + shape.radius) < self.x_max)
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

    pub fn draw(&self, canvas: web_sys::HtmlCanvasElement) {
        let helper = math::CanvasHelper::new(
            canvas.width() as f64,
            canvas.height() as f64,
            self.arena.width(),
            self.arena.height(),
        );

        // Draw background
        let ctx = utils::ctx_from_canvas(&canvas);

        ctx.set_fill_style(&JsValue::from_str(style::colour::BACKGROUND));
        ctx.fill_rect(0.0, 0.0, helper.c_width(), helper.c_height());
        ctx.stroke();

        for player in &self.team_a {
            player.draw(&canvas, &helper);
        }

        for player in &self.team_b {
            player.draw(&canvas, &helper);
        }
    }
}
