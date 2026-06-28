//! Backend for the experience-people identification map.
//!
//! Exposes a small JSON API over axum. Per-space people counts and the
//! latest AI detection are kept in Redis so multiple backend instances
//! share state. The static floor plan is in-memory and seeded from
//! `models::seed_floor`.
//!
//! Endpoints (all JSON, prefix `/api/v1`):
//! - `GET  /health`                            health probe
//! - `GET  /api/v1/floor`                      full floor plan + counts
//! - `POST /api/v1/spaces/{id}/count`          update a space's count
//! - `GET  /api/v1/spaces/{id}/stream`         MJPEG camera stream
//! - `POST /api/v1/detections`                 AI detection ingest
//! - `POST /api/v1/detections/infer`           call YOLO model + ingest
//! - `GET  /api/v1/detections/latest`          most recent detection

pub mod camera;
pub mod handlers;
pub mod models;
pub mod state;
pub mod store;

pub use state::AppState;
