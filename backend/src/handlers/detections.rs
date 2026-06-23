use crate::{
    models::{ApiError, DetectionInput, DetectionRecord, LatestDetectionResponse},
    state::AppState,
    store,
};
use axum::{Json, extract::State, http::StatusCode};
use std::sync::Arc;

pub async fn create_detection(
    State(state): State<Arc<AppState>>,
    Json(input): Json<DetectionInput>,
) -> Result<(StatusCode, Json<DetectionRecord>), ApiError> {
    validate_confidence(input.confidence)?;

    let record = DetectionRecord {
        camera_id: clean_or_default(input.camera_id, "main"),
        space_id: input.space_id,
        people_count: input.people_count,
        confidence: input.confidence,
        source: clean_or_default(input.source, "ai"),
        captured_at: input.captured_at,
        received_at_ms: crate::models::now_ms(),
    };

    store::save_latest_detection(&state.redis, &record).await?;

    if let Some(space_id) = record.space_id {
        let _ = store::save_count(
            &state.redis,
            space_id,
            record.people_count,
            record.received_at_ms,
        )
        .await;
    }

    Ok((StatusCode::CREATED, Json(record)))
}

pub async fn latest_detection(
    State(state): State<Arc<AppState>>,
) -> Result<Json<LatestDetectionResponse>, ApiError> {
    let detection = store::load_latest_detection(&state.redis).await?;
    Ok(Json(LatestDetectionResponse { detection }))
}

fn validate_confidence(confidence: Option<f32>) -> Result<(), ApiError> {
    if let Some(c) = confidence
        && (!c.is_finite() || !(0.0..=1.0).contains(&c))
    {
        return Err(ApiError::BadRequest(
            "confidence must be a number between 0 and 1".to_string(),
        ));
    }
    Ok(())
}

fn clean_or_default(value: Option<String>, fallback: &str) -> String {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}
