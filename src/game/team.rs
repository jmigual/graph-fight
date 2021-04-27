use std::char::MAX;

use rand::Rng;
use web_sys::HtmlCanvasElement;

use super::{Arena, Player};
use crate::{
    geometry::*,
    utils::{self, NotFoundError},
};

const MAX_ITERS: u64 = 100;

pub struct Team {
    area: Rectangle,
    players: Vec<Player>,
}

impl Team {
    pub fn new(area: Rectangle) -> Team {
        Team {
            area,
            players: Vec::new(),
        }
    }

    pub fn add_players<R: Rng + ?Sized>(
        &mut self,
        team_size: usize,
        player_size: f64,
        arena: &Arena,
        rng: &mut R,
    ) -> Result<(), utils::NotFoundError> {
        self.players.reserve(team_size);

        for _ in 0..team_size {
            let shape = self.find_random_pos(player_size, &arena, rng)?;
            self.players.push(Player::from_circle(shape));
        }

        Ok(())
    }

    fn find_random_pos<R: Rng + ?Sized>(
        &self,
        player_size: f64,
        arena: &Arena,
        rng: &mut R,
    ) -> Result<Circle, NotFoundError> {
        let x_range = self.area.range_h();
        let y_range = self.area.range_v();

        for _ in 0..MAX_ITERS {
            let pos = Point::random(&x_range, &y_range, rng);
            let shape = Circle::new(pos, player_size);

            if self.is_valid_pos(&shape, &arena) {
                return Ok(shape);
            }
        }

        Err(utils::NotFoundError::new("No valid position found"))
    }

    fn is_valid_pos(&self, shape: &Circle, arena: &Arena) -> bool {
        let f = |p: &Player| !p.shape().collision_circle(shape);

        // Collision with other players
        if !self.players.iter().all(f) {
            return false;
        }

        arena.is_free_pos(&shape)
    }

    pub fn draw(&self, canvas: &HtmlCanvasElement, helper: &CanvasHelper, team_num: usize) {
        for player in self.players.iter() {
            player.draw(&canvas, &helper, team_num);
        }
    }
}
