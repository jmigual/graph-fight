use std::char::MAX;

use rand::Rng;
use rand_distr::{Distribution, Normal};
use web_sys::HtmlCanvasElement;

use crate::{
    geometry::{
        math::{CanvasHelper, Point},
        Circle, Rectangle,
    },
    utils::NotFoundError,
};

use super::{Obstacle, Team};

pub struct Arena {
    area: Rectangle,
    obstacles: Vec<Obstacle>,
    teams: Vec<Team>,
}

const MAX_ITERS: usize = 100;

impl Arena {
    pub fn new(width: f64, height: f64) -> Arena {
        Arena {
            area: Rectangle::new((0.0, 0.0).into(), width, height),
            obstacles: Vec::new(),
            teams: Vec::new(),
        }
    }

    pub fn add_obstacles<R: Rng + ?Sized>(
        &mut self,
        num_obstacles: usize,
        min_obstacle_size: f64,
        max_obstacle_size: f64,
        rng: &mut R,
    ) -> Result<(), NotFoundError> {
        let distr = Normal::new((max_obstacle_size - min_obstacle_size) / 2.0, 0.8).unwrap();
        let x_range = self.area.range_h();
        let y_range = self.area.range_v();

        self.obstacles.reserve(num_obstacles);
        for _ in 0..num_obstacles {
            let obstacle_size = distr
                .sample(rng)
                .clamp(min_obstacle_size, max_obstacle_size);

            let shape = self.find_random_pos(obstacle_size, rng)?;
            self.obstacles.push(Obstacle::from_circle(shape));
        }

        Ok(())
    }

    pub fn add_teams<R: Rng + ?Sized>(
        &mut self,
        players_per_team: &Vec<usize>,
        player_size: f64,
        rng: &mut R,
    ) -> Result<(), NotFoundError> {
        let areas = self.area.partition(players_per_team.len() as u64);

        for (team_size, area) in players_per_team.iter().zip(areas.iter()) {
            let mut team = Team::new(area.clone());
            team.add_players(*team_size, player_size, &self, rng)?;
            self.teams.push(team);
        }

        Ok(())
    }

    /// True if there is a collision with a player
    pub fn collision_with_player(&self, shape: &Circle) -> bool {
        self.teams.iter().any(|t| t.collision_with_player(&shape))
    }

    /// True if there is a collision with an obstacle
    pub fn collision_with_obstacle(&self, shape: &Circle) -> bool {
        self.obstacles
            .iter()
            .any(|o| o.shape().collision_circle(&shape))
    }

    pub fn area(&self) -> &Rectangle {
        &self.area
    }

    /// Clears the entire arena, leaving it blank
    pub fn clear(&mut self) {
        self.obstacles.clear();
        self.teams.clear();
    }

    pub fn draw(&self, canvas: &HtmlCanvasElement, helper: &CanvasHelper) {
        for obstacle in &self.obstacles {
            obstacle.draw(&canvas, &helper);
        }

        for team in &self.teams {
            team.draw_area(canvas, helper);
        }

        for (i, team) in self.teams.iter().enumerate() {
            team.draw(canvas, helper, i);
        }
    }

    fn find_random_pos<R: Rng + ?Sized>(
        &self,
        obstacle_size: f64,
        rng: &mut R,
    ) -> Result<Circle, NotFoundError> {
        let range_h = self.area.range_h();
        let range_v = self.area.range_v();

        for _ in 0..MAX_ITERS {
            let pos = Point::random(&range_h, &range_v, rng);
            let shape = Circle::new(pos, obstacle_size);

            // A obstacle position is fine as long as it doesn't collide with a player
            if !self.collision_with_player(&shape) {
                return Ok(shape);
            }
        }

        Err(NotFoundError::new("No valid position found for obstacle"))
    }
}
