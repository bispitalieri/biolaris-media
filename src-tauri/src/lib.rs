mod app;
mod commands;
mod constants;
mod crash_handler;
mod formats;
mod images;
mod models;
mod paths;
mod tools;

rust_i18n::i18n!("locales");

/// Wrapper around `rust_i18n::t!` that always returns `String`.
/// Usage: `t!("key")` or `t!("key", arg = value)`
#[macro_export]
macro_rules! t {
    ($key:literal) => {
        $crate::__t_string!($key)
    };
    ($key:literal, $($arg:ident = $val:expr),+ $(,)?) => {
        $crate::__t_string!($key, $($arg = $val),+)
    };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __t_string {
    ($key:literal) => {
        rust_i18n::t!($key).to_string()
    };
    ($key:literal, $($arg:ident = $val:expr),+ $(,)?) => {
        rust_i18n::t!($key, $($arg = $val),+).to_string()
    };
}

pub fn run() {
    app::run();
}
