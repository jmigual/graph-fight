mod obstacle;
mod player;

use rand::{rngs::SmallRng, SeedableRng};
use rand_distr::{Distribution, Normal};
use wasm_bindgen::prelude::*;

use crate::geometry::*;
use crate::utils;

pub use self::obstacle::Obstacle;
pub use self::player::Player;

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
#[derive(Clone)]
pub struct Game {
    team_a: Vec<Player>,
    team_b: Vec<Player>,
    obstacles: Vec<Circle>,
    explosions: Vec<Circle>,
    arena: Rectangle,
    rng: SmallRng,
}

#[wasm_bindgen]
/// Represents a game instance.
impl Game {
    /// Creates a new game instance.
    ///
    /// # Arguments
    ///
    /// * `x_max` - The maximum absolute x-coordinate value of the game arena.
    /// * `y_max` - The maximum absolute y-coordinate value of the game arena.
    /// * `num_obstacles` - The number of obstacles in the game.
    /// * `obstacle_size` - The size of each obstacle.
    /// * `num_players_a` - The number of players in team A.
    /// * `num_players_b` - The number of players in team B.
    /// * `player_radius` - The radius of each player.
    /// * `seed` - The seed value for the random number generator.
    ///
    /// # Returns
    ///
    /// Returns a `Result` containing the created `Game` instance if successful, or an error 
    /// message if any of the input values are invalid.
    #[wasm_bindgen(constructor)]
    pub fn new(
        x_max: f64,
        y_max: f64,
        num_obstacles: usize,
        obstacle_size: f64,
        num_players_a: usize,
        num_players_b: usize,
        player_radius: f64,
        seed: u64,
    ) -> Result<Game, String> {
        utils::set_panic_hook();

        if x_max <= 0. || y_max <= 0. {
            return Err("x_max and y_max must have a positive value".into());
        }

        if obstacle_size <= 0. || player_radius <= 0. {
            return Err("Obstacle size and player radius must be a positive value".into());
        }

        let mut game = Game {
            team_a: Vec::with_capacity(num_players_a),
            team_b: Vec::with_capacity(num_players_b),
            obstacles: Vec::with_capacity(num_obstacles),
            explosions: Vec::new(),
            arena: Rectangle::new((0.0, 0.0).into(), 2.0 * x_max, 2.0 * y_max),
            rng: SmallRng::seed_from_u64(seed),
        };

        // May fail if the player radius is too big
        game.create_team(num_players_a, num_players_b, player_radius)?;
        game.create_obstables(num_obstacles, obstacle_size)?;

        Ok(game)
    }

    #[wasm_bindgen(js_name = "teamA")]
    pub fn team_a_s(&self) -> Vec<Player> {
        self.team_a.clone()
    }

    #[wasm_bindgen(js_name = "teamB")]
    pub fn team_b_s(&self) -> Vec<Player> {
        self.team_b.clone()
    }

    #[wasm_bindgen(js_name = "obstacles")]
    pub fn obstacles_s(&self) -> Vec<Circle> {
        self.obstacles.clone()
    }

    #[wasm_bindgen(js_name = "explosions")]
    pub fn explosions_s(&self) -> Vec<Circle> {
        self.explosions.clone()
    }

    #[wasm_bindgen(js_name = "arena")]
    pub fn arena_s(&self) -> Rectangle {
        self.arena.clone()
    }
}

impl Game {
    fn create_team(
        &mut self,
        num_players_a: usize,
        num_players_b: usize,
        player_radius: f64,
    ) -> Result<(), String> {
        // Vertical range is the same for both sides
        let p_range_y = Range::new(self.arena.bottom(), self.arena.top());

        // Player A goes on the left side
        let p_a_range_x = Range::new(self.arena.left(), 0.);

        for _ in 0..num_players_a {
            let shape =
                self.find_random_pos(&p_a_range_x, &p_range_y, player_radius, &Type::Player)?;
            let new_player = Player::from_circle(shape);
            self.team_a.push(new_player);
        }

        // Player B goes on the right side
        let p_b_range_x = Range::new(0., self.arena.right());
        for _ in 0..num_players_b {
            let shape =
                self.find_random_pos(&p_b_range_x, &p_range_y, player_radius, &Type::Player)?;

            let new_player = Player::from_circle(shape);
            self.team_b.push(new_player);
        }

        Ok(())
    }

    fn create_obstables(
        &mut self,
        num_obstacles: usize,
        max_obstacle_size: f64,
    ) -> Result<(), String> {
        let range_x = Range::new(self.arena.left(), self.arena.right());
        let range_y = Range::new(self.arena.bottom(), self.arena.top());

        let distr = Normal::new(max_obstacle_size / 2.0, 1.0).unwrap();

        for _ in 0..num_obstacles {
            let obstacle_size = distr.sample(&mut self.rng);

            let shape = self.find_random_pos(&range_x, &range_y, obstacle_size, &Type::Obstacle)?;
            self.obstacles.push(shape);
        }

        Ok(())
    }

    fn is_valid_pos(&self, shape: &Circle, pos_type: &Type) -> bool {
        let f = |p: &Player| !p.shape().collision_circle(shape);

        // Collision with players from team A
        if !self.team_a.iter().all(f) {
            return false;
        }

        // Collision with players from team B
        if !self.team_b.iter().all(f) {
            return false;
        }

        match pos_type {
            Type::Player => {
                let f = |p: &Circle| !p.collision_circle(shape);

                // Collision with obstacles
                if !self.obstacles.iter().all(f) {
                    return false;
                }

                let pos = shape.pos();

                if !self.arena.inside(&pos) {
                    return false;
                }

                self.arena.left() + shape.radius() <= pos.x
                    && self.arena.right() - shape.radius() >= pos.x
                    && self.arena.bottom() + shape.radius() <= pos.y
                    && self.arena.top() - shape.radius() >= pos.y
            }
            // Obstacles can collide with anything that is not a player
            Type::Obstacle => true,
        }
    }

    fn find_random_pos(
        &mut self,
        x_range: &Range<f64>,
        y_range: &Range<f64>,
        radius: f64,
        pos_type: &Type,
    ) -> Result<Circle, String> {
        for _ in 0..100 {
            let pos = Point::random(&x_range, &y_range, &mut self.rng);
            let shape = Circle::new(pos, radius);

            if self.is_valid_pos(&shape, &pos_type) {
                return Ok(shape);
            }
        }
        Err("No valid position found".into())
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
            player.draw(&canvas, &helper, player::style::Team::Right);
        }

        for player in &self.team_b {
            player.draw(&canvas, &helper, player::style::Team::Left);
        }

        // for obstacle in &self.obstacles {
            // obstacle.draw(&canvas, &helper);
        // }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_pos() {
        let game = Game::new(10.0, 10.0, 0, 0.1, 0, 0, 0.1, 0).unwrap();

        let pos = vec![
            ((0.0, 0.0), true),
            ((5.0, 5.0), true),
            ((-5.0, 5.0), true),
            ((-5.0, -5.0), true),
            ((5.0, -5.0), true),
            ((20.0, 20.0), false),
            ((-20.0, 20.0), false),
            ((-20.0, -20.0), false),
            ((20.0, -20.0), false),
            ((7.0, 0.0), false),
            ((7.0, 7.0), false),
        ];

        for (p, r) in pos {
            let c = Circle::new(p.into(), 4.0);
            assert_eq!(game.is_valid_pos(&c, &Type::Player), r);
        }
    }

    #[test]
    fn test_build() {
        let game = Game::new(20.0, 10.0, 2, 0.2, 4, 4, 0.5, 0);
        game.unwrap();
    }
}
