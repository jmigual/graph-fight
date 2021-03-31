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

pub struct Range<T: PartialOrd> {
    min: T,
    max: T,
}

impl<T: PartialOrd + Copy> Range<T> {
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
}
