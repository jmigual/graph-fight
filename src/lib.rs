mod shapes;
mod utils;

use js_sys::Math;
use shapes::*;
use std::vec::Vec;
use wasm_bindgen::prelude::*;

// When the `wee_alloc` feature is enabled, use `wee_alloc` as the global
// allocator.
#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

struct Player {
    pos: Point,
    radius: f64,
    alive: bool,
}

impl Player {
    fn new(pos: Point, radius: f64) -> Player {
        Player {
            pos,
            radius,
            alive: true,
        }
    }
}

#[wasm_bindgen]
pub struct GraphFight {
    team_a: Vec<Player>,
    team_b: Vec<Player>,
    obstacles: Vec<Circle>,
    x_max: f64,
    y_max: f64,
}

#[wasm_bindgen]
impl GraphFight {
    pub fn new(
        x_max: f64,
        y_max: f64,
        num_obstacles: usize,
        obstacle_size: f64,
        num_players_a: usize,
        num_players_b: usize,
        player_radius: f64,
    ) -> Result<GraphFight, JsValue> {
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

        let mut team_a = Vec::with_capacity(num_players_a);
        let mut team_b = Vec::with_capacity(num_players_b);
        let mut obstacles = Vec::with_capacity(num_obstacles);

        // Vertical range is the same for both sides
        let p_range_y = Range::new(-y_max, y_max);

        // Player A goes on the left side
        let p_a_range_x = Range::new(-x_max, 0.);
        for _ in 0..num_players_a {
            let pos = match find_random_pos(
                &p_a_range_x,
                &p_range_y,
                &team_a,
                &team_b,
                &obstacles,
                player_radius,
            ) {
                Ok(p) => p,
                Err(error) => return Err(JsValue::from_str(error.message())),
            };

            let new_player = Player::new(pos, player_radius);
            team_a.push(new_player);
        }

        // Player B goes on the right side
        let p_b_range_x = Range::new(0., x_max);
        for _ in 0..num_players_b {
            let pos = match find_random_pos(
                &p_b_range_x,
                &p_range_y,
                &team_a,
                &team_b,
                &obstacles,
                player_radius,
            ) {
                Ok(p) => p,
                Err(error) => return Err(JsValue::from_str(error.message())),
            };

            let new_player = Player::new(pos, player_radius);
            team_b.push(new_player);
        }

        // Before placing an obstacle check that

        for _ in 0..num_obstacles {}

        Ok(GraphFight {
            team_a,
            team_b,
            obstacles,
            x_max,
            y_max,
        })
    }
}

fn is_valid_pos(
    pos: &Point,
    radius: f64,
    team_a: &Vec<Player>,
    team_b: &Vec<Player>,
    obstacles: &Vec<Circle>,
) -> bool {
    true
}

fn find_random_pos(
    x_range: &Range<f64>,
    y_range: &Range<f64>,
    team_a: &Vec<Player>,
    team_b: &Vec<Player>,
    obstacles: &Vec<Circle>,
    radius: f64,
) -> Result<Point, utils::NotFoundError> {
    for _ in 0..100 {
        let pos = Point::random(&x_range, &y_range);
        if is_valid_pos(&pos, radius, &team_a, &team_b, &obstacles) {
            return Ok(pos);
        }
    }

    Err(utils::NotFoundError::new("No valid position found"))
}
