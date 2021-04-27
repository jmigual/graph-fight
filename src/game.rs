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
pub struct Game {
    teams: Vec<Vec<Player>>,
    obstacles: Vec<Obstacle>,
    arena: Rectangle,
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
        players_per_team: &[usize],
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
            arena: Rectangle::new((0.0, 0.0).into(), 2.0 * x_max, 2.0 * y_max),
            rng: SmallRng::seed_from_u64(seed as u64),
        };

        // May fail if the player radius is too big
        game.create_team(players_per_team, player_radius)?;
        game.create_obstables(num_obstacles, obstacle_size)?;

        Ok(game)
    }

    fn create_team(
        &mut self,
        players_per_team: &[usize],
        player_radius: f64,
    ) -> Result<(), JsValue> {
        // Vertical range is the same for both sides
        let p_range_y = Range::new(self.arena.bottom(), self.arena.top());

        // Player A goes on the left side
        let p_a_range_x = Range::new(self.arena.left(), 0.);

        for team_size in players_per_team {
            let team = Vec::with_capacity(*team_size);
            for _ in 0..*team_size {
                let shape = match self.find_random_pos(
                    &p_a_range_x,
                    &p_range_y,
                    player_radius,
                    &Type::Player,
                ) {
                    Ok(p) => p,
                    Err(error) => return Err(JsValue::from_str(error.message())),
                };
    
                let new_player = Player::from_circle(shape);
                team.push(new_player);
            }
            self.teams.push(team);
        }

        Ok(())
    }

    fn create_obstables(
        &mut self,
        num_obstacles: usize,
        max_obstacle_size: f64,
    ) -> Result<(), JsValue> {
        let range_x = Range::new(self.arena.left(), self.arena.right());
        let range_y = Range::new(self.arena.bottom(), self.arena.top());

        let distr = Normal::new(max_obstacle_size / 2.0, 1.0).unwrap();

        for _ in 0..num_obstacles {
            let obstacle_size = distr.sample(&mut self.rng);

            let shape =
                match self.find_random_pos(&range_x, &range_y, obstacle_size, &Type::Obstacle) {
                    Ok(p) => p,
                    Err(error) => return Err(JsValue::from_str(error.message())),
                };

            let new_obstacle = Obstacle::from_circle(shape);
            self.obstacles.push(new_obstacle);
        }

        Ok(())
    }

    fn is_valid_pos(&self, shape: &Circle, pos_type: &Type) -> bool {
        let f = |p: &Player| !p.shape().collision_circle(shape);

        // Collision with players
        if !self.teams.iter().flatten().all(f) {
            return false;
        }

        match pos_type {
            Type::Player => {
                let f = |p: &Obstacle| !p.shape().collision_circle(shape);

                // Collision with obstacles
                if !self.obstacles.iter().all(f) {
                    return false;
                }

                let pos = shape.pos();

                if !self.arena.inside(&pos) {
                    return false;
                }

                // A player cannot collide with the border
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
    ) -> Result<Circle, utils::NotFoundError> {
        for _ in 0..100 {
            let pos = Point::random(&x_range, &y_range, &mut self.rng);
            let shape = Circle::new(pos, radius);

            if self.is_valid_pos(&shape, &pos_type) {
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

        for (i, team) in self.teams.iter().enumerate() {
            for player in team {
                
            }
        }

        for player in &self.team_a {
            player.draw(&canvas, &helper, player::style::Team::Right);
        }

        for player in &self.team_b {
            player.draw(&canvas, &helper, player::style::Team::Left);
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
    fn test_valid_pos() {
        let game = Game::new(10.0, 10.0, 0, 0.1, 0, 0, 0.1, 0.0).unwrap();

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
        let game = Game::new(20.0, 10.0, 2, 0.2, 4, 4, 0.5, 0.0);
        game.unwrap();
    }
}
