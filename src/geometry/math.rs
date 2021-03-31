use std::cmp::PartialOrd;
use std::ops::{Add, Sub};
use serde::{Serialize, Deserialize};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
#[derive(Serialize, Deserialize, Clone)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[wasm_bindgen]
#[allow(dead_code)]
impl Point {
    #[wasm_bindgen(constructor)]
    pub fn new(x: f64, y: f64) -> Point {
        Point { x, y }
    }
}

#[allow(dead_code)]
impl Point {

    pub fn random(x_range: &Range<f64>, y_range: &Range<f64>) -> Point {
        let x = rand::random::<f64>() * (x_range.max() - x_range.min());
        let y = rand::random::<f64>() * (y_range.max() - y_range.min());

        Point { x, y }
    }

    pub fn distance_to(&self, other: &Point) -> f64 {
        ((self.x - other.x).powf(2.0) + (self.y - other.y).powf(2.0)).sqrt()
    }

}

impl Add<&Point> for Point {
    type Output = Self;

    fn add(self, rhs: &Point) -> Self {
        Point {
            x: self.x + rhs.x,
            y: self.y + rhs.y,
        }
    }
}

impl Sub<&Point> for Point {
    type Output = Self;

    fn sub(self, rhs: &Point) -> Self {
        Point {
            x: self.x - rhs.x,
            y: self.y - rhs.y,
        }
    }
}

pub struct Range<T: PartialOrd = f64> {
    min: T,
    max: T,
}

impl<T: num::Float> Range<T> {
    pub fn new(min: T, max: T) -> Range<T> {
        if min > max {
            panic!("min must be smaller or equal than max");
        }

        Range { min, max }
    }

    pub fn min(&self) -> T {
        self.min
    }

    pub fn max(&self) -> T {
        self.max
    }

    pub fn width(&self) -> T {
        self.max - self.min
    }

    pub fn interpolate(&self, x: T) -> T {
        (x - self.min) / self.width()
    }
}

pub struct CanvasHelper {
    c_x_size: u32,
    c_y_size: u32,

    g_x_range: Range,
    g_y_range: Range
}

impl CanvasHelper {
    pub fn map_point(&self, p: &Point) -> (u32, u32) {
        // Canvas coordinates go from left to right and top to bottom while our coordinates
        // go from left to right and bottom to top

        let mut x = self.g_x_range.interpolate(p.x);
        let mut y = self.g_x_range.interpolate(p.y);

        x *= self.c_x_size as f64;
        y *= self.c_y_size as f64;

        (x.round() as u32, y.round() as u32)
    }
}
