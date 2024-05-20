use rand::{
    distributions::{uniform::Uniform, Distribution},
    Rng,
};
use serde::Serialize;
use tsify::Tsify;
use std::{
    cmp::PartialOrd,
    ops::{Add, Sub},
};

use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Clone, Debug, Serialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

impl Point {
    pub fn new(x: f64, y: f64) -> Point {
        Point { x, y }
    }

    pub fn random<R: Rng + ?Sized>(
        x_range: &Range<f64>,
        y_range: &Range<f64>,
        rng: &mut R,
    ) -> Point {
        let dist = Uniform::from(0.0..1.0);
        let x = dist.sample(rng) * (x_range.max() - x_range.min()) + x_range.min();
        let y = dist.sample(rng) * (y_range.max() - y_range.min()) + y_range.min();

        Point { x, y }
    }

    pub fn random_default(x_range: &Range<f64>, y_range: &Range<f64>) -> Point {
        Point::random(&x_range, &y_range, &mut rand::thread_rng())
    }

    pub fn distance_to(&self, other: &Point) -> f64 {
        ((self.x - other.x).powi(2) + (self.y - other.y).powi(2)).sqrt()
    }
}

impl Add for &Point {
    type Output = Point;

    fn add(self, rhs: &Point) -> Self::Output {
        Self::Output {
            x: self.x + rhs.x,
            y: self.y + rhs.y,
        }
    }
}

impl Add for Point {
    type Output = Self;

    fn add(self, rhs: Point) -> Self::Output {
        Self::Output {
            x: self.x + rhs.x,
            y: self.y + rhs.y,
        }
    }
}

impl Sub for Point {
    type Output = Self;

    fn sub(self, rhs: Point) -> Self::Output {
        Self::Output {
            x: self.x - rhs.x,
            y: self.y - rhs.y,
        }
    }
}

impl Sub for &Point {
    type Output = Point;
    fn sub(self, rhs: &Point) -> Self::Output {
        Self::Output {
            x: self.x - rhs.x,
            y: self.y - rhs.y,
        }
    }
}

impl From<(f64, f64)> for Point {
    fn from(p: (f64, f64)) -> Point {
        Point { x: p.0, y: p.1 }
    }
}

#[derive(Debug)]
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

    /// Reduce the length of the range by x on both sides
    pub fn subtract_both(&self, x: T) -> Range<T> {
        Range::new(self.min + x, self.max - x)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_distance() {
        let a = Point::new(0.0, 0.0);
        let b = Point::new(10.0, 10.0);

        let distance = a.distance_to(&b);

        assert!(distance >= 14.14 && distance <= 14.15);
    }

    #[test]
    fn test_sub() {
        let a = Point::new(0.0, 0.0);
        let b = Point::new(10.0, 5.0);
        let c = &a - &b;
        assert!(c.x <= -9.99 && c.x >= -10.01 && c.y <= -4.99 && c.y >= -5.01);

        let c = a - b;
        assert!(c.x <= -9.99 && c.x >= -10.01 && c.y <= -4.99 && c.y >= -5.01);
    }
}
