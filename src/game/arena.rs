use std::f64::consts::TAU;

use rand::Rng;
use rand_distr::{Distribution, Normal};
use serde::Serialize;
use tsify::Tsify;
use wasm_bindgen::prelude::wasm_bindgen;

use crate::geometry::{
    math::Point,
    Circle, Rectangle,
};

use super::{Field, Team};

#[derive(Clone, PartialEq, Serialize, Tsify)]
#[tsify(into_wasm_abi)]
#[serde(rename_all = "camelCase")]
pub struct Arena {
    /// The client knows the field it asked for, so it is not serialized.
    #[serde(skip)]
    field: Field,
    x_max: f64,
    y_max: f64,
    area: Rectangle,
    obstacles: Vec<Circle>,
    holes: Vec<Circle>,
    teams: Vec<Team>,
}

const MAX_ITERS: usize = 100;

/// Radius of the crater a shot leaves in an obstacle (ADR 4).
const CRATER_RADIUS: f64 = 0.5;

impl Arena {
    // #[wasm_bindgen(js_name = "area")]
    // pub fn js_area(&self) -> Rectangle {
    //     self.area.clone()
    // }

    // pub fn js_obstacles(&self) -> Vec<Circle> {
    //     self.obstacles.clone()
    // }

    pub fn x_max(&self) -> f64 {
        self.x_max
    }

    pub fn y_max(&self) -> f64 {
        self.y_max
    }

    pub fn area(&self) -> Rectangle {
        self.area.clone()
    }
}

impl Arena {
    pub fn new(field: Field, x_max: f64, y_max: f64) -> Arena {
        Arena {
            field,
            x_max,
            y_max,
            area: Rectangle::new((0.0, 0.0).into(), 2. * x_max, 2. * y_max),
            obstacles: Vec::new(),
            holes: Vec::new(),
            teams: Vec::new(),
        }
    }

    /// True if the point lies inside the playing field. On a disc the radius is `y_max`.
    pub fn contains(&self, point: &Point) -> bool {
        match self.field {
            Field::Xy => self.area.inside(point),
            Field::Disc => point.x.hypot(point.y) <= self.y_max,
        }
    }

    /// True if an obstacle can be placed here: on a disc it must lie fully inside the field,
    /// on the XY field only its centre must.
    fn obstacle_fits(&self, shape: &Circle) -> bool {
        match self.field {
            Field::Xy => self.contains(shape.pos()),
            Field::Disc => shape.pos().x.hypot(shape.pos().y) + shape.radius() <= self.y_max,
        }
    }

    pub fn add_obstacles<R: Rng + ?Sized>(
        &mut self,
        num_obstacles: usize,
        min_obstacle_size: f64,
        max_obstacle_size: f64,
        rng: &mut R,
    ) -> Result<(), String> {
        let distribution = Normal::new((max_obstacle_size - min_obstacle_size) / 2.0, 0.8).unwrap();

        self.obstacles.reserve(num_obstacles);
        for _ in 0..num_obstacles {
            let obstacle_size = distribution
                .sample(rng)
                .clamp(min_obstacle_size, max_obstacle_size);

            let shape = self.find_random_pos(obstacle_size, rng)?;
            self.obstacles.push(shape);
        }

        Ok(())
    }

    pub fn add_teams<R: Rng + ?Sized>(
        &mut self,
        players_per_team: &Vec<usize>,
        player_size: f64,
        rng: &mut R,
    ) -> Result<(), String> {
        let num_teams = players_per_team.len();
        let areas = self.area.partition(num_teams as u64);

        for (i, (team_size, area)) in players_per_team.iter().zip(areas.iter()).enumerate() {
            let mut team = Team::new();
            let sample = |rng: &mut R, radius: f64| match self.field {
                Field::Xy => Point::random(
                    &area.range_h().subtract_both(radius),
                    &area.range_v().subtract_both(radius),
                    rng,
                ),
                Field::Disc => {
                    // Uniform in the annulus [R/2, R - radius], within the team's sector
                    let sector = TAU / num_teams as f64;
                    let theta = sector * (i as f64 + rng.gen_range(-0.5..0.5));
                    let (r_min, r_max) = (self.y_max / 2., self.y_max - radius);
                    let r = rng.gen_range(r_min * r_min..=r_max * r_max).sqrt();
                    Point::new(r * theta.cos(), r * theta.sin())
                }
            };
            team.add_players(*team_size, player_size, &self, rng, sample)?;
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
            .any(|o| o.collision_circle(&shape))
    }

    /// True if the point is inside an obstacle and not inside any crater, i.e. a shot stops here.
    pub fn blocks(&self, point: &Point) -> bool {
        self.obstacles.iter().any(|o| o.contains(point))
            && !self.holes.iter().any(|h| h.contains(point))
    }

    /// Leaves a crater at `pos`, which later shots pass through.
    pub fn add_crater(&mut self, pos: Point) {
        self.holes.push(Circle::new(pos, CRATER_RADIUS));
    }

    pub fn obstacles(&self) -> &[Circle] {
        &self.obstacles
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
        self.holes.clear();
        self.teams.clear();
    }

    fn find_random_pos<R: Rng + ?Sized>(
        &self,
        obstacle_size: f64,
        rng: &mut R,
    ) -> Result<Circle, String> {
        let range_h = self.area.range_h();
        let range_v = self.area.range_v();

        for _ in 0..MAX_ITERS {
            let pos = Point::random(&range_h, &range_v, rng);
            let shape = Circle::new(pos, obstacle_size);

            // A obstacle position is fine as long as it is inside the field and doesn't collide
            // with a player
            if self.obstacle_fits(&shape) && !self.collision_with_player(&shape) {
                return Ok(shape);
            }
        }

        Err("No valid position found for obstacle".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crater_lets_shots_through() {
        let mut arena = Arena::new(Field::Xy, 10., 10.);
        arena.obstacles.push(Circle::new((0., 0.).into(), 2.));
        let inside: Point = (0.5, 0.).into();
        let elsewhere: Point = (1.5, 0.).into();

        assert!(arena.blocks(&inside));
        assert!(!arena.blocks(&(5., 0.).into()));

        arena.add_crater(inside.clone());
        assert!(!arena.blocks(&inside));
        assert!(arena.blocks(&elsewhere));
        assert_eq!(arena.holes.len(), 1);

        arena.clear();
        assert!(arena.holes.is_empty());
    }
}
