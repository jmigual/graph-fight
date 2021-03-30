use std::fmt;

pub fn set_panic_hook() {
    // When the `console_error_panic_hook` feature is enabled, we can call the
    // `set_panic_hook` function at least once during initialization, and then
    // we will get better error messages if our code ever panics.
    //
    // For more details see
    // https://github.com/rustwasm/console_error_panic_hook#readme
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

#[derive(Debug, Clone)]
pub struct NotFoundError {
    message: String
}

impl NotFoundError {
    pub fn new(message: &str) -> NotFoundError {
        NotFoundError { message: String::from(message) }
    }

    pub fn message(&self) -> &str {
        &self.message
    }
}

impl fmt::Display for NotFoundError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}


