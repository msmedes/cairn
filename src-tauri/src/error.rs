use std::error::Error;
use std::fmt::{Display, Formatter};

#[derive(Debug)]
pub(crate) struct CairnError {
    message: String,
}

impl CairnError {
    pub(crate) fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl Display for CairnError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl Error for CairnError {}

pub(crate) type CairnResult<T> = Result<T, CairnError>;

#[expect(
    clippy::needless_pass_by_value,
    reason = "Designed for Result::map_err, which passes owned errors."
)]
pub(crate) fn command_error(error: CairnError) -> String {
    error.to_string()
}

pub(crate) fn app_error(message: impl Into<String>) -> CairnError {
    CairnError::new(message)
}
