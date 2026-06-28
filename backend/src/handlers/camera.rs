use std::sync::Arc;
use std::time::Duration;

use axum::{
    body::{Body, Bytes},
    extract::{Path, State},
    http::{HeaderValue, Response, StatusCode, header},
};
use serde::Deserialize;

use crate::camera::{CameraSource, SyntheticSource, current_count};
use crate::models::ApiError;
use crate::state::AppState;

const FRAME_INTERVAL: Duration = Duration::from_millis(120); // ~8 fps

#[derive(Debug, Deserialize)]
pub struct SpacePath {
    pub id: u8,
}

/// `GET /api/v1/spaces/{id}/stream` — multipart/x-mixed-replace MJPEG.
///
/// Each part is a complete JPEG frame; the response never closes under
/// normal operation, so the browser keeps decoding the live feed until
/// the tab is closed or the space changes (the React component simply
/// re-points the `<img src>` and the browser opens a new connection).
pub async fn stream_space(
    State(state): State<Arc<AppState>>,
    Path(SpacePath { id }): Path<SpacePath>,
) -> Result<Response<Body>, ApiError> {
    let floor = state.floor.lock().await;
    if !floor.spaces.iter().any(|s| s.id == id) {
        return Err(ApiError::NotFound);
    }
    drop(floor);

    let source = SyntheticSource::new();
    let boundary = format!("mjpegspace{id}");
    let initial_count = current_count(&state, id).await;
    let stream = build_mjpeg_response(state, id, source, initial_count, boundary);

    Ok(stream)
}

fn build_mjpeg_response(
    state: Arc<AppState>,
    space_id: u8,
    source: SyntheticSource,
    initial_count: u32,
    boundary: String,
) -> Response<Body> {
    let content_type = format!("multipart/x-mixed-replace; boundary={boundary}");

    // The stream itself never errors; we just need the error type to
    // be pinned to something `Into<BoxError>`. We use a tiny wrapper
    // stream that re-emits the inner one with a concrete error type.
    let body_stream = async_stream::try_stream! {
        use std::fmt::Write as _;
        let mut last_count = initial_count;
        let mut ticker = tokio::time::interval(FRAME_INTERVAL);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        loop {
            // Pull the latest count from Redis on every tick so the
            // stream reflects manual / AI updates within a few frames.
            let count = current_count(&state, space_id).await;
            if count != last_count {
                last_count = count;
            }

            let frame = source.next_frame(space_id, last_count);
            let mut header = String::with_capacity(128);
            write!(
                &mut header,
                "\r\n--{boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: {}\r\n\r\n",
                frame.jpeg.len()
            )
            .expect("writing to String is infallible");
            let mut bytes = header.into_bytes();
            bytes.extend_from_slice(&frame.jpeg);
            yield Bytes::from(bytes);

            ticker.tick().await;
        }
    };

    // Wrap in a TryStream adapter to pin the error type to
    // `std::io::Error`, which axum's `Body::from_stream` accepts.
    let pinned: std::pin::Pin<
        Box<dyn futures_core::Stream<Item = Result<Bytes, std::io::Error>> + Send>,
    > = Box::pin(futures_util::TryStreamExt::map_ok(
        body_stream,
        std::convert::identity,
    ));

    let body = Body::from_stream(pinned);
    Response::builder()
        .status(StatusCode::OK)
        .header(
            header::CONTENT_TYPE,
            HeaderValue::from_str(&content_type).unwrap(),
        )
        .header(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-cache, no-store, must-revalidate"),
        )
        .header(header::PRAGMA, HeaderValue::from_static("no-cache"))
        .body(body)
        .expect("static response builder should not fail")
}
