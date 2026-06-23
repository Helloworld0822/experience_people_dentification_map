use std::sync::Arc;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde::Deserialize;

use crate::{
    models::{ApiError, CountUpdate, FloorData, SpaceCount, zone_infos},
    state::AppState,
    store,
};

/// `GET /api/v1/floor` — full snapshot of the floor plan with live
/// per-space counts.
pub async fn get_floor(State(state): State<Arc<AppState>>) -> Result<Json<FloorData>, ApiError> {
    let floor = state.floor.lock().await;
    let space_ids: Vec<u8> = floor.spaces.iter().map(|s| s.id).collect();
    let counts = store::load_all_counts(&state.redis, &space_ids).await?;
    Ok(Json(FloorData {
        viewbox: floor.viewbox.clone(),
        zones: zone_infos(),
        spaces: floor.spaces.clone(),
        counts,
        generated_at_ms: crate::models::now_ms(),
    }))
}

#[derive(Debug, Deserialize)]
pub struct SpacePath {
    pub id: u8,
}

/// `POST /api/v1/spaces/{id}/count` — update a space's people count.
pub async fn update_count(
    State(state): State<Arc<AppState>>,
    Path(SpacePath { id }): Path<SpacePath>,
    Json(input): Json<CountUpdate>,
) -> Result<(StatusCode, Json<SpaceCount>), ApiError> {
    let floor = state.floor.lock().await;
    if !floor.spaces.iter().any(|s| s.id == id) {
        return Err(ApiError::NotFound);
    }
    drop(floor);

    let updated = store::save_count(&state.redis, id, input.count, crate::models::now_ms()).await?;
    Ok((StatusCode::ACCEPTED, Json(updated)))
}
