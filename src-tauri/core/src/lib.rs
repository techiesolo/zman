//! The parts of zman that the webview cannot do itself: sending HTTP requests
//! without browser restrictions, and reading and writing the local data files.

pub mod http;
pub mod storage;
