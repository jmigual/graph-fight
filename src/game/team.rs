use rand::Rng;
use tsify::Tsify;
use serde::Serialize;

use super::{Arena, Player};
use crate::geometry::*;

const MAX_ITERS: u64 = 100;

#[derive(Clone, Serialize,Tsify)]
#[tsify(into_wasm_abi)]
#[serde(rename_all = "camelCase")]
pub struct Team {
    area: Rectangle,
    players: Vec<Player>,
    current_player: usize,
}

impl Team {
    pub fn new(area: Rectangle) -> Team {
        Team {
            area,
            players: Vec::new(),
            current_player: 0,
        }
    }

    pub fn add_players<R: Rng + ?Sized>(
        &mut self,
        team_size: usize,
        player_size: f64,
        arena: &Arena,
        rng: &mut R,
    ) -> Result<(), String> {
        self.players.reserve(team_size);

        for _ in 0..team_size {
            let shape = self.find_random_pos(player_size, &arena, rng)?;
            self.players.push(Player::from_circle(shape));
        }

        Ok(())
    }

    /// True if the shape collides with any player of the team
    pub fn collision_with_player(&self, shape: &Circle) -> bool {
        self.players
            .iter()
            .any(|p| p.shape().collision_circle(&shape))
    }

    pub fn get_current_player(&self) -> Option<&Player> {
        if self.players[self.current_player].alive() {
            Some(&self.players[self.current_player])
        } else {
            None
        }
    }

    pub fn get_current_player_mut(&mut self) -> Option<&mut Player> {
        if self.players[self.current_player].alive() {
            Some(&mut self.players[self.current_player])
        } else {
            None
        }
    }

    /// Moves to the next alive player, returns `false` if no player is alive
    pub fn next_player(&mut self) -> bool {
        // Try to find the next alive player
        for i in 1..self.players.len() {
            let idx = (self.current_player + i) % self.players.len();

            if self.players[idx].alive() {
                self.current_player = idx;
                return true;
            }
        }

        false
    }

    /// True if some players in a team are still alive
    pub fn is_alive(&self) -> bool {
        self.players.iter().any(|p| p.alive())
    }

    fn find_random_pos<R: Rng + ?Sized>(
        &self,
        player_size: f64,
        arena: &Arena,
        rng: &mut R,
    ) -> Result<Circle, String> {
        let x_range = self.area.range_h().subtract_both(player_size);
        let y_range = self.area.range_v().subtract_both(player_size);

        for _ in 0..MAX_ITERS {
            let pos = Point::random(&x_range, &y_range, rng);
            let shape = Circle::new(pos, player_size);

            if self.is_valid_pos(&shape, &arena) {
                return Ok(shape);
            }
        }

        Err("No valid position found".into())
    }

    fn is_valid_pos(&self, shape: &Circle, arena: &Arena) -> bool {
        let f = |p: &Player| !p.shape().collision_circle(shape);

        // Collision with other players from same team
        if !self.players.iter().all(f) {
            return false;
        }

        !arena.collision_with_obstacle(shape)
    }
}
