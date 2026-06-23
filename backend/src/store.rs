use redis::AsyncCommands;

use crate::models::{ApiError, DetectionRecord, SpaceCount};

const LATEST_DETECTION_KEY: &str = "people_detection:latest";
const SPACE_COUNT_KEY_PREFIX: &str = "people_detection:space:";

pub fn space_count_key_str(space_id: u8) -> String {
    format!("{SPACE_COUNT_KEY_PREFIX}{space_id}")
}

fn space_count_key(space_id: u8) -> String {
    space_count_key_str(space_id)
}

/// Persist the latest AI detection so the rest of the system can read it
/// from a single key. The payload is JSON-serialised.
pub async fn save_latest_detection(
    redis: &redis::Client,
    record: &DetectionRecord,
) -> Result<(), ApiError> {
    let payload = serde_json::to_string(record)?;
    let mut conn = redis.get_multiplexed_async_connection().await?;
    conn.set::<_, _, ()>(LATEST_DETECTION_KEY, payload).await?;
    Ok(())
}

/// Load the most recent detection, or `None` if no detection has been
/// recorded yet.
pub async fn load_latest_detection(
    redis: &redis::Client,
) -> Result<Option<DetectionRecord>, ApiError> {
    let mut conn = redis.get_multiplexed_async_connection().await?;
    let payload: Option<String> = conn.get(LATEST_DETECTION_KEY).await?;
    let detection = payload
        .map(|value| serde_json::from_str::<DetectionRecord>(&value))
        .transpose()?;
    Ok(detection)
}

/// Read every space's current count. Spaces with no record are skipped;
/// the caller should treat a missing space as `count = 0`.
pub async fn load_all_counts(
    redis: &redis::Client,
    space_ids: &[u8],
) -> Result<Vec<SpaceCount>, ApiError> {
    let mut conn = redis.get_multiplexed_async_connection().await?;
    let mut out = Vec::with_capacity(space_ids.len());
    for &id in space_ids {
        let key = space_count_key(id);
        let payload: Option<String> = conn.get(&key).await?;
        if let Some(payload) = payload {
            let parsed: SpaceCount = serde_json::from_str(&payload)?;
            out.push(parsed);
        }
    }
    Ok(out)
}

/// Update the count for a single space, stamped with the current time.
pub async fn save_count(
    redis: &redis::Client,
    space_id: u8,
    count: u32,
    updated_at_ms: i64,
) -> Result<SpaceCount, ApiError> {
    let record = SpaceCount {
        space_id,
        count,
        updated_at_ms,
    };
    let payload = serde_json::to_string(&record)?;
    let mut conn = redis.get_multiplexed_async_connection().await?;
    conn.set::<_, _, ()>(&space_count_key(space_id), payload)
        .await?;
    Ok(record)
}
