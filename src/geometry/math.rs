use serde::{Deserialize, Serialize};
use std::cmp::PartialOrd;
use std::ops::{Add, Sub};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[allow(dead_code)]
impl Point {
    pub fn new(x: f64, y: f64) -> Point {
        Point { x, y }
    }
}

#[allow(dead_code)]
impl Point {
    pub fn random(x_range: &Range<f64>, y_range: &Range<f64>) -> Point {
        let x = rand::random::<f64>() * (x_range.max() - x_range.min()) + x_range.min();
        let y = rand::random::<f64>() * (y_range.max() - y_range.min()) + y_range.min();

        Point { x, y }
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
}

pub struct CanvasHelper {
    c_x_size: f64,
    c_y_size: f64,

    g_x_range: Range,
    g_y_range: Range,
}

impl CanvasHelper {
    pub fn new(c_width: f64, c_height: f64, width: f64, height: f64) -> CanvasHelper {
        CanvasHelper {
            c_x_size: c_width,
            c_y_size: c_height,
            g_x_range: Range::new(-width/2.0, width/2.0),
            g_y_range: Range::new(-height/2.0, height/2.0),
        }
    }

    pub fn c_width(&self) -> f64 {
        self.c_x_size
    }

    pub fn c_height(&self) -> f64 {
        self.c_y_size
    }

    pub fn to_canvas_point(&self, p: &Point) -> (f64, f64) {
        // Canvas coordinates go from left to right and top to bottom while our coordinates
        // go from left to right and bottom to top

        let mut x = self.g_x_range.interpolate(p.x);
        let mut y = self.g_y_range.interpolate(p.y);

        x *= self.c_x_size;
        y = self.c_y_size * (1.0 - y);

        (x, y)
    }

    pub fn to_canvas_vector(&self, p: &Point) -> (f64, f64) {
        // Map a vector to a canvas vector
        let x = p.x * self.c_x_size / self.g_x_range.width();
        let y = p.y * self.c_y_size / self.g_y_range.width();

        (x, y)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use float_cmp::approx_eq;

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

    #[test]
    fn test_map_point() {
        let helper = CanvasHelper::new(50.0, 60.0, 10.0, 10.0);

        let input = vec![
            (0.0, 0.0),
            (-10.0, 0.0),
            (-10.0, -10.0),
            (-10.0, 10.0),
            (10.0, 10.0),
            (10.0, -10.0),
            (5.0, 5.0),
        ];
        let expected = vec![
            (25.0, 30.0),
            (0.0, 30.0),
            (0.0, 60.0),
            (0.0, 0.0),
            (50.0, 0.0),
            (50.0, 60.0),
            (37.5, 15.0),
        ];

        for ((i1, i2), (e1, e2)) in input.iter().zip(expected.iter()) {
            let a = Point::new(*i1, *i2);
            let mapped = helper.to_canvas_point(&a);
            let result = approx_eq!(f64, mapped.0, *e1) && approx_eq!(f64, mapped.1, *e2);

            if !result {
                println!(
                    "Error comparing points, expected ({}, {}), got ({}, {}) for input point {:?}",
                    e1, e2, mapped.0, mapped.1, a
                )
            }

            assert!(result);
        }
    }
}
