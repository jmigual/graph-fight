// tsify 0.5 deprecates `into_wasm_abi` (it panics on a failed conversion, and unwinding
// leaks). These types only serialize, so the conversion cannot fail; `Ts<T>` would change the
// signatures the Rust tests call.
#![expect(deprecated)]

use rand::Rng;
use tsify::Tsify;
use serde::Serialize;

use super::{Arena, Player};
use crate::geometry::*;

const MAX_ITERS: u64 = 100;

#[derive(Clone, Default, PartialEq, Serialize, Tsify)]
#[tsify(into_wasm_abi)]
#[serde(rename_all = "camelCase")]
pub struct Team {
    players: Vec<Player>,
    current_player: usize,
}

impl Team {
    pub fn new() -> Team {
        Team {
            players: Vec::new(),
            current_player: 0,
        }
    }

    /// Places `team_size` players. `sample(rng, radius)` draws a candidate centre for a player
    /// of the given radius, from wherever this team is allowed to stand.
    pub fn add_players<R: Rng + ?Sized>(
        &mut self,
        team_size: usize,
        player_size: f64,
        arena: &Arena,
        rng: &mut R,
        sample: impl Fn(&mut R, f64) -> Point,
    ) -> Result<(), String> {
        self.players.reserve(team_size);

        for _ in 0..team_size {
            let shape = self.find_random_pos(player_size, &arena, rng, &sample)?;
            self.players.push(Player::from_circle(shape));
        }

        Ok(())
    }

    pub fn players(&self) -> &[Player] {
        &self.players
    }

    #[cfg(test)]
    pub fn from_positions(positions: &[(f64, f64)], radius: f64) -> Team {
        Team {
            players: positions
                .iter()
                .map(|&p| Player::new(p.into(), radius))
                .collect(),
            current_player: 0,
        }
    }

    /// Kills every living player containing `point`, except the one at index `spare`.
    pub fn kill_at(&mut self, point: &Point, spare: Option<usize>) {
        for (i, p) in self.players.iter_mut().enumerate() {
            if p.alive() && Some(i) != spare && p.shape().contains(point) {
                p.kill();
            }
        }
    }

    /// True if the shape collides with any player of the team
    pub fn collision_with_player(&self, shape: &Circle) -> bool {
        self.players
            .iter()
            .any(|p| p.shape().collision_circle(&shape))
    }

    /// The player whose turn it is, or `None` if that player is dead (or the team is empty).
    pub fn get_current_player(&self) -> Option<&Player> {
        self.players.get(self.current_player).filter(|p| p.alive())
    }

    pub fn get_current_player_mut(&mut self) -> Option<&mut Player> {
        self.players
            .get_mut(self.current_player)
            .filter(|p| p.alive())
    }

    /// Index of the player whose turn it is.
    pub fn current_index(&self) -> usize {
        self.current_player
    }

    /// Kills every player.
    pub fn eliminate(&mut self) {
        self.players.iter_mut().for_each(Player::kill);
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
        sample: &impl Fn(&mut R, f64) -> Point,
    ) -> Result<Circle, String> {
        for _ in 0..MAX_ITERS {
            let pos = sample(rng, player_size);
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

        // Earlier teams are already in the arena; sectors can touch on a disc
        !arena.collision_with_obstacle(shape) && !arena.collision_with_player(shape)
    }
}
