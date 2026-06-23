use std::sync::Arc;
use std::time::Instant;

use redis::Client;
use tokio::sync::Mutex;

use crate::models::{Space, seed_floor};

/// Shared application state, cheap to clone (it is an `Arc`).
#[derive(Clone)]
pub struct AppState {
    /// Redis client used for per-space counts and the latest detection.
    pub redis: Client,
    /// Static floor plan (spaces and viewbox). Wrapped in a Mutex so
    /// `cargo` future evolution stays easy; today this is read-only.
    pub floor: Arc<Mutex<Floor>>,
    /// Server start time, used for the `/health` uptime field.
    pub started_at: Arc<Instant>,
}

pub struct Floor {
    pub viewbox: crate::models::ViewBox,
    pub spaces: Vec<Space>,
}

impl AppState {
    /// Build a state that talks to `redis_url` and seeds the floor plan.
    pub fn new(redis_url: &str) -> Result<Self, redis::RedisError> {
        let redis = Client::open(redis_url)?;
        let (viewbox, spaces) = seed_floor();
        Ok(Self {
            redis,
            floor: Arc::new(Mutex::new(Floor { viewbox, spaces })),
            started_at: Arc::new(Instant::now()),
        })
    }

    pub async fn uptime_secs(&self) -> f64 {
        self.started_at.elapsed().as_secs_f64()
    }
}
