use crate::models::HealthResponse;
use crate::state::AppState;
use axum::{Json, extract::State};
use std::sync::Arc;

pub async fn health(State(state): State<Arc<AppState>>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        uptime_secs: state.uptime_secs().await,
    })
}
