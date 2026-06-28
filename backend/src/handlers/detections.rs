use crate::{
    models::{
        ApiError, DetectionInferInput, DetectionInferResponse, DetectionInput, DetectionRecord,
        LatestDetectionResponse, YoloDetectionResponse,
    },
    state::AppState,
    store,
};
use axum::{Json, extract::State, http::StatusCode};
use serde::Serialize;
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
        inference_ms: input.inference_ms,
        density_score: input.density_score,
        density_level: input.density_level,
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

#[derive(Debug, Serialize)]
struct YoloInferRequest<'a> {
    image_base64: &'a str,
    confidence: f32,
    dense_mode: bool,
    request_id: &'a str,
}

pub async fn infer_and_create_detection(
    State(state): State<Arc<AppState>>,
    Json(input): Json<DetectionInferInput>,
) -> Result<(StatusCode, Json<DetectionInferResponse>), ApiError> {
    validate_confidence(input.confidence)?;

    let confidence = input.confidence.unwrap_or(0.55);
    let dense_mode = input.dense_mode.unwrap_or(true);
    let camera_id = clean_or_default(input.camera_id, "main");
    let image_base64 = input.image_base64.trim();
    if image_base64.is_empty() {
        return Err(ApiError::BadRequest("image_base64 is required".to_string()));
    }
    let request_id = format!("{camera_id}-{}", crate::models::now_ms());
    let yolo_payload = YoloInferRequest {
        image_base64,
        confidence,
        dense_mode,
        request_id: &request_id,
    };

    let yolo = state
        .http
        .post(&state.yolo_detect_url)
        .json(&yolo_payload)
        .send()
        .await
        .map_err(|err| ApiError::Internal(format!("failed to call model server: {err}")))?;

    if !yolo.status().is_success() {
        return Err(ApiError::BadRequest(format!(
            "model server returned status {}",
            yolo.status()
        )));
    }

    let yolo_result: YoloDetectionResponse = yolo
        .json()
        .await
        .map_err(|err| ApiError::Internal(format!("invalid model response payload: {err}")))?;

    let best_confidence = yolo_result
        .boxes
        .iter()
        .map(|box_item| box_item.confidence)
        .max_by(|left, right| left.total_cmp(right));
    let inferred = DetectionRecord {
        camera_id,
        space_id: input.space_id,
        people_count: yolo_result.count,
        confidence: best_confidence,
        inference_ms: yolo_result.inference_ms,
        density_score: yolo_result.density.as_ref().and_then(|d| d.score),
        density_level: yolo_result.density.as_ref().and_then(|d| d.level.clone()),
        source: clean_or_default(input.source, "programming_exam"),
        captured_at: input.captured_at,
        received_at_ms: crate::models::now_ms(),
    };

    store::save_latest_detection(&state.redis, &inferred).await?;
    if let Some(space_id) = inferred.space_id {
        let _ = store::save_count(
            &state.redis,
            space_id,
            inferred.people_count,
            inferred.received_at_ms,
        )
        .await;
    }

    Ok((
        StatusCode::CREATED,
        Json(DetectionInferResponse {
            detection: inferred,
            model_count: yolo_result.count,
            inference_ms: yolo_result.inference_ms,
            density_score: yolo_result.density.as_ref().and_then(|d| d.score),
            density_level: yolo_result.density.and_then(|d| d.level),
        }),
    ))
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
