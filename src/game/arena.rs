use std::{collections::BTreeMap, rc::Rc};

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

use super::{Drawable, Obstacle, Team};

pub struct Arena {
    area: Rectangle,
    obstacles: Vec<Rc<Obstacle>>,
    teams: Vec<Team>,
    objects: BTreeMap<i32, Vec<Rc<dyn Drawable>>>,
}

const MAX_ITERS: usize = 100;

mod layers {
    pub const OBSTACLE: i32 = 10;
    pub const PLAYER: i32 = 20;
    pub const TEAM_DELIMITER: i32 = 0;
}

impl Arena {
    pub fn new(width: f64, height: f64) -> Arena {
        Arena {
            area: Rectangle::new((0.0, 0.0).into(), width, height),
            obstacles: Vec::new(),
            teams: Vec::new(),
            objects: BTreeMap::new(),
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

        self.obstacles.reserve(num_obstacles);
        for _ in 0..num_obstacles {
            let obstacle_size = distr
                .sample(rng)
                .clamp(min_obstacle_size, max_obstacle_size);

            let shape = self.find_random_pos(obstacle_size, rng)?;
            let obstacle = Rc::new(Obstacle::from_circle(shape));
            self.obstacles.push(Rc::clone(&obstacle));

            // Insert new vector if it's not there already
            match self.objects.get_mut(&layers::OBSTACLE) {
                Some(v) => v.push(obstacle),
                None => {
                    self.objects.insert(layers::OBSTACLE, vec![obstacle]);
                }
            }
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

    pub fn get_area(&self) -> &Rectangle {
        &self.area
    }

    pub fn get_teams(&self) -> &Vec<Team> {
        &self.teams
    }

    pub fn get_teams_mut(&mut self) -> &mut Vec<Team> {
        &mut self.teams
    }

    /// Clears the entire arena, leaving it blank
    pub fn clear(&mut self) {
        self.obstacles.clear();
        self.teams.clear();
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

impl Drawable for Arena {
    fn draw(&self, canvas: &HtmlCanvasElement, helper: &CanvasHelper) {
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
}
