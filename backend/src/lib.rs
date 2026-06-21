//! Backend for the experience-people identification map.
//!
//! Exposes a small JSON API over axum: people and experiences
//! are kept in an in-memory `HashMap` guarded by a `tokio::Mutex`.
//!
//! Endpoints (all JSON, prefix `/api/v1`):
//! - `GET  /`                                  service info
//! - `GET  /health`                            health probe
//! - `GET  /people`                            list people
//! - `POST /people`                            create a person
//! - `GET  /people/:id`                        fetch one
//! - `GET  /experiences[?category=...]`        list (optionally filtered)
//! - `POST /experiences`                       create an experience
//! - `GET  /experiences/:id`                   fetch one
//! - `GET  /map`                               aggregated markers for the map UI

pub mod models;
pub mod routes;
pub mod state;

pub use state::AppState;
