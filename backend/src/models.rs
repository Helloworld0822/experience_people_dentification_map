use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use thiserror::Error;
use uuid::Uuid;

/// Returns the current UNIX timestamp in seconds.
pub fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Person record stored in the in-memory state.
#[derive(Debug, Clone, Serialize)]
pub struct Person {
    pub id: Uuid,
    pub name: String,
    pub role: String,
    pub lat: f64,
    pub lng: f64,
    pub created_at: i64,
}

/// Payload accepted by `POST /api/v1/people`.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct NewPerson {
    pub name: String,
    pub role: String,
    pub lat: f64,
    pub lng: f64,
}

/// Experience record stored in the in-memory state.
#[derive(Debug, Clone, Serialize)]
pub struct Experience {
    pub id: Uuid,
    pub title: String,
    pub description: String,
    pub category: String,
    pub lat: f64,
    pub lng: f64,
    pub person_id: Option<Uuid>,
    pub created_at: i64,
}

/// Payload accepted by `POST /api/v1/experiences`.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct NewExperience {
    pub title: String,
    pub description: String,
    pub category: String,
    pub lat: f64,
    pub lng: f64,
    pub person_id: Option<Uuid>,
}

/// A normalized marker exposed via `/api/v1/map`.
#[derive(Debug, Clone, Serialize)]
pub struct MapMarker {
    pub kind: MarkerKind,
    pub id: Uuid,
    pub lat: f64,
    pub lng: f64,
    pub label: String,
    pub category: String,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MarkerKind {
    Person,
    Experience,
}

/// Aggregated payload returned by `/api/v1/map`.
#[derive(Debug, Clone, Serialize)]
pub struct MapData {
    pub markers: Vec<MapMarker>,
    pub people_count: usize,
    pub experiences_count: usize,
}

/// Service info returned by `GET /`.
#[derive(Debug, Clone, Serialize)]
pub struct ServiceInfo {
    pub name: &'static str,
    pub version: &'static str,
    pub status: &'static str,
    pub endpoints: Vec<(&'static str, &'static str)>,
}

/// Health check response.
#[derive(Debug, Clone, Serialize)]
pub struct Health {
    pub status: &'static str,
    pub uptime_secs: f64,
}

/// Top-level API error type. Implements `IntoResponse` so handlers can
/// simply `?` propagate errors and the framework serializes a JSON body
/// with the right status code.
#[derive(Debug, Error)]
pub enum ApiError {
    #[error("resource not found")]
    NotFound,
    #[error("invalid request: {0}")]
    BadRequest(String),
    #[error("internal error: {0}")]
    Internal(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            ApiError::NotFound => (StatusCode::NOT_FOUND, self.to_string()),
            ApiError::BadRequest(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            ApiError::Internal(_) => {
                tracing::error!(error = %self, "internal error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal server error".to_string(),
                )
            }
        };
        (status, Json(serde_json::json!({ "error": message }))).into_response()
    }
}
