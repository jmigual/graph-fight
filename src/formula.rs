//! Hand-written formula parser (ADR 3): parse once, evaluate many times.

use std::{
    f64::consts::{E, PI},
    fmt,
};

/// Maximum nesting of unary minus, parentheses and `^` exponents.
const MAX_DEPTH: usize = 64;

/// Maximum formula length in characters; also bounds the depth of left-deep
/// `+ - * /` chains, which the nesting limit does not see.
pub(crate) const MAX_LEN: usize = 256;

/// Why a formula failed to parse.
#[derive(Debug, Clone, PartialEq)]
pub enum ParseError {
    /// A character that cannot start any token.
    UnexpectedChar(char),
    /// The formula ended in the middle of an expression.
    UnexpectedEnd,
    /// A valid token in a place where it is not allowed.
    UnexpectedToken(char),
    /// A malformed number such as `1.2.3` or `.`.
    InvalidNumber(String),
    /// A name that is neither the bound variable, a constant nor a function.
    UnknownName(String),
    /// Nesting deeper than [`MAX_DEPTH`].
    TooDeep,
    /// More than [`MAX_LEN`] characters.
    TooLong,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ParseError::UnexpectedChar(c) => write!(f, "Unexpected character '{c}'"),
            ParseError::UnexpectedEnd => f.write_str("The formula ends unexpectedly"),
            ParseError::UnexpectedToken(c) => write!(f, "Unexpected '{c}'"),
            ParseError::InvalidNumber(n) => write!(f, "Invalid number '{n}'"),
            ParseError::UnknownName(n) => write!(f, "Unknown name '{n}'"),
            ParseError::TooDeep => f.write_str("The formula is nested too deeply"),
            ParseError::TooLong => write!(f, "The formula is longer than {MAX_LEN} characters"),
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum Op {
    Add,
    Sub,
    Mul,
    Div,
    Pow,
}

#[derive(Debug, Clone)]
enum Node {
    Num(f64),
    Var,
    Neg(Box<Node>),
    Bin(Op, Box<Node>, Box<Node>),
    Call(fn(f64) -> f64, Box<Node>),
}

impl Node {
    fn eval(&self, v: f64) -> f64 {
        match self {
            Node::Num(n) => *n,
            Node::Var => v,
            Node::Neg(a) => -a.eval(v),
            Node::Bin(op, a, b) => {
                let (a, b) = (a.eval(v), b.eval(v));
                match op {
                    Op::Add => a + b,
                    Op::Sub => a - b,
                    Op::Mul => a * b,
                    Op::Div => a / b,
                    Op::Pow => a.powf(b),
                }
            }
            Node::Call(f, a) => f(a.eval(v)),
        }
    }
}

/// A parsed formula in one variable.
#[derive(Debug, Clone)]
pub struct Formula(Node);

impl Formula {
    /// Parses `src`, where `var` is the one variable name allowed (`x`, `t` or
    /// `θ`). `theta` is accepted as an ASCII alias of `θ`.
    pub fn parse(src: &str, var: &str) -> Result<Self, ParseError> {
        if src.chars().count() > MAX_LEN {
            return Err(ParseError::TooLong);
        }
        let mut p = Parser {
            chars: src.chars().collect(),
            pos: 0,
            var,
            depth: 0,
        };
        let node = p.expr()?;
        match p.peek() {
            None => Ok(Formula(node)),
            Some(c) => Err(unexpected(c)),
        }
    }

    /// Evaluates the formula with the variable set to `v`.
    pub fn eval(&self, v: f64) -> f64 {
        self.0.eval(v)
    }
}

/// `UnexpectedToken` for characters the grammar knows, `UnexpectedChar` for
/// the rest, wherever they appear.
fn unexpected(c: char) -> ParseError {
    if c.is_alphanumeric() || ".+-*/^()".contains(c) {
        ParseError::UnexpectedToken(c)
    } else {
        ParseError::UnexpectedChar(c)
    }
}

struct Parser<'a> {
    chars: Vec<char>,
    pos: usize,
    var: &'a str,
    depth: usize,
}

impl Parser<'_> {
    fn peek(&mut self) -> Option<char> {
        while self.chars.get(self.pos).is_some_and(|c| c.is_whitespace()) {
            self.pos += 1;
        }
        self.chars.get(self.pos).copied()
    }

    fn eat(&mut self, c: char) -> bool {
        let found = self.peek() == Some(c);
        if found {
            self.pos += 1;
        }
        found
    }

    fn expect(&mut self, c: char) -> Result<(), ParseError> {
        match self.peek() {
            Some(found) if found == c => {
                self.pos += 1;
                Ok(())
            }
            Some(found) => Err(unexpected(found)),
            None => Err(ParseError::UnexpectedEnd),
        }
    }

    fn bin(op: Op, a: Node, b: Node) -> Node {
        Node::Bin(op, Box::new(a), Box::new(b))
    }

    fn expr(&mut self) -> Result<Node, ParseError> {
        let mut left = self.term()?;
        loop {
            let op = match self.peek() {
                Some('+') => Op::Add,
                Some('-') => Op::Sub,
                _ => return Ok(left),
            };
            self.pos += 1;
            left = Self::bin(op, left, self.term()?);
        }
    }

    fn term(&mut self) -> Result<Node, ParseError> {
        let mut left = self.unary()?;
        loop {
            let op = match self.peek() {
                Some('*') => Op::Mul,
                Some('/') => Op::Div,
                _ => return Ok(left),
            };
            self.pos += 1;
            left = Self::bin(op, left, self.unary()?);
        }
    }

    /// Every nesting path (`-`, `(`, `^`) goes through here, so the depth is
    /// bounded here.
    fn unary(&mut self) -> Result<Node, ParseError> {
        if self.depth == MAX_DEPTH {
            return Err(ParseError::TooDeep);
        }
        self.depth += 1;
        let node = if self.eat('-') {
            self.unary().map(|a| Node::Neg(Box::new(a)))
        } else {
            self.power()
        };
        self.depth -= 1;
        node
    }

    /// `^` binds tighter than unary minus and is right-associative, and its
    /// exponent may carry a sign: `-x^2 = -(x^2)`, `2^3^2 = 2^9`, `2^-1 = 0.5`.
    fn power(&mut self) -> Result<Node, ParseError> {
        let base = self.atom()?;
        if self.eat('^') {
            Ok(Self::bin(Op::Pow, base, self.unary()?))
        } else {
            Ok(base)
        }
    }

    fn atom(&mut self) -> Result<Node, ParseError> {
        match self.peek() {
            None => Err(ParseError::UnexpectedEnd),
            Some('(') => {
                self.pos += 1;
                let node = self.expr()?;
                self.expect(')')?;
                Ok(node)
            }
            Some(c) if c.is_ascii_digit() || c == '.' => self.number(),
            Some(c) if c.is_alphabetic() => self.name(),
            Some(c) => Err(unexpected(c)),
        }
    }

    fn number(&mut self) -> Result<Node, ParseError> {
        let start = self.pos;
        while self
            .chars
            .get(self.pos)
            .is_some_and(|c| c.is_ascii_digit() || *c == '.')
        {
            self.pos += 1;
        }
        let text: String = self.chars[start..self.pos].iter().collect();
        text.parse()
            .map(Node::Num)
            .map_err(|_| ParseError::InvalidNumber(text))
    }

    fn name(&mut self) -> Result<Node, ParseError> {
        let start = self.pos;
        while self
            .chars
            .get(self.pos)
            .is_some_and(|c| c.is_alphanumeric())
        {
            self.pos += 1;
        }
        let name: String = self.chars[start..self.pos].iter().collect();
        let canonical = if name == "theta" { "θ" } else { &name };
        if canonical == self.var {
            return Ok(Node::Var);
        }
        match canonical {
            "pi" => return Ok(Node::Num(PI)),
            "e" => return Ok(Node::Num(E)),
            _ => {}
        }
        let f: fn(f64) -> f64 = match canonical {
            "sin" => f64::sin,
            "cos" => f64::cos,
            "tan" => f64::tan,
            "asin" => f64::asin,
            "acos" => f64::acos,
            "atan" => f64::atan,
            "sinh" => f64::sinh,
            "cosh" => f64::cosh,
            "tanh" => f64::tanh,
            "sqrt" => f64::sqrt,
            "abs" => f64::abs,
            "exp" => f64::exp,
            "ln" => f64::ln,
            "log10" => f64::log10,
            "floor" => f64::floor,
            "ceil" => f64::ceil,
            _ => return Err(ParseError::UnknownName(name)),
        };
        self.expect('(')?;
        let arg = self.expr()?;
        self.expect(')')?;
        Ok(Node::Call(f, Box::new(arg)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(src: &str, v: f64) -> f64 {
        Formula::parse(src, "x").unwrap().eval(v)
    }

    fn err(src: &str) -> ParseError {
        Formula::parse(src, "x").unwrap_err()
    }

    #[test]
    fn precedence_and_parentheses() {
        assert_eq!(ev("1 + 2 * 3", 0.0), 7.0);
        assert_eq!(ev("(1 + 2) * 3", 0.0), 9.0);
        assert_eq!(ev("8 / 4 / 2", 0.0), 1.0);
        assert_eq!(ev("10 - 4 - 3", 0.0), 3.0);
        assert_eq!(ev("2 * x + .5", 3.0), 6.5);
    }

    #[test]
    fn power_is_right_associative() {
        assert_eq!(ev("2^3^2", 0.0), 512.0);
        assert_eq!(ev("2^-1", 0.0), 0.5);
    }

    #[test]
    fn unary_minus() {
        assert_eq!(ev("-x^2", 3.0), -9.0);
        assert_eq!(ev("(-x)^2", 3.0), 9.0);
        assert_eq!(ev("--x", 3.0), 3.0);
        assert_eq!(ev("2 * -x", 3.0), -6.0);
    }

    #[test]
    fn constants_and_functions() {
        assert_eq!(ev("pi", 0.0), PI);
        assert_eq!(ev("e", 0.0), E);
        assert_eq!(ev("sin(pi / 2)", 0.0), 1.0);
        assert_eq!(ev("sqrt(x)", 16.0), 4.0);
        assert_eq!(ev("abs(-x)", 2.0), 2.0);
        assert_eq!(ev("ln(exp(x))", 2.0), 2.0);
        assert_eq!(ev("floor(x) + ceil(x)", 1.5), 3.0);
    }

    #[test]
    fn theta_and_alias() {
        let a = Formula::parse("θ^2", "θ").unwrap();
        let b = Formula::parse("theta^2", "θ").unwrap();
        assert_eq!(a.eval(3.0), 9.0);
        assert_eq!(b.eval(3.0), 9.0);
        assert_eq!(
            Formula::parse("theta", "x").unwrap_err(),
            ParseError::UnknownName("theta".into())
        );
    }

    #[test]
    fn non_finite_results_are_values() {
        assert!(ev("1 / x", 0.0).is_infinite());
        assert!(ev("sqrt(x)", -1.0).is_nan());
    }

    #[test]
    fn errors() {
        assert_eq!(err("2 $ 3"), ParseError::UnexpectedChar('$'));
        assert_eq!(err("$"), ParseError::UnexpectedChar('$'));
        assert_eq!(err(""), ParseError::UnexpectedEnd);
        assert_eq!(err("1 +"), ParseError::UnexpectedEnd);
        assert_eq!(err("(1"), ParseError::UnexpectedEnd);
        assert_eq!(err("1 * * 2"), ParseError::UnexpectedToken('*'));
        assert_eq!(err("1)"), ParseError::UnexpectedToken(')'));
        assert_eq!(err("2x"), ParseError::UnexpectedToken('x'));
        assert_eq!(err("sin x"), ParseError::UnexpectedToken('x'));
        assert_eq!(err("1.2.3"), ParseError::InvalidNumber("1.2.3".into()));
        assert_eq!(err("."), ParseError::InvalidNumber(".".into()));
        assert_eq!(err("y + 1"), ParseError::UnknownName("y".into()));
        assert_eq!(err("foo(1)"), ParseError::UnknownName("foo".into()));
        assert_eq!(err(&"(".repeat(100)), ParseError::TooDeep);
        assert_eq!(err(&"-".repeat(100)), ParseError::TooDeep);
        assert_eq!(
            err(&format!("{}x", "x+".repeat(300_000))),
            ParseError::TooLong
        );
    }
}
