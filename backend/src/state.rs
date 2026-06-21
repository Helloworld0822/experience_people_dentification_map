use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;

use tokio::sync::Mutex;
use uuid::Uuid;

use crate::models::{Experience, Person};

/// Shared application state, cheap to clone (it is an `Arc`).
#[derive(Clone)]
pub struct AppState {
    pub people: Arc<Mutex<HashMap<Uuid, Person>>>,
    pub experiences: Arc<Mutex<HashMap<Uuid, Experience>>>,
    pub started_at: Arc<Instant>,
}

impl AppState {
    /// Builds a fresh state, optionally pre-populated with a few
    /// sample records so the map endpoint is non-empty on first boot.
    pub fn new() -> Self {
        let mut people = HashMap::new();
        let mut experiences = HashMap::new();

        // Seed records (Seoul coordinates).
        let alice = Person {
            id: Uuid::new_v4(),
            name: "Alice Kim".to_string(),
            role: "Designer".to_string(),
            lat: 37.5665,
            lng: 126.9780,
            created_at: crate::models::now_secs(),
        };
        let bob = Person {
            id: Uuid::new_v4(),
            name: "Bob Lee".to_string(),
            role: "Engineer".to_string(),
            lat: 37.5519,
            lng: 126.9912,
            created_at: crate::models::now_secs(),
        };
        people.insert(alice.id, alice.clone());
        people.insert(bob.id, bob.clone());

        let exp = Experience {
            id: Uuid::new_v4(),
            title: "City Hall lighting walk".to_string(),
            description: "A short evening walk through the lit-up civic center.".to_string(),
            category: "walk".to_string(),
            lat: 37.5663,
            lng: 126.9779,
            person_id: Some(alice.id),
            created_at: crate::models::now_secs(),
        };
        experiences.insert(exp.id, exp);

        Self {
            people: Arc::new(Mutex::new(people)),
            experiences: Arc::new(Mutex::new(experiences)),
            started_at: Arc::new(Instant::now()),
        }
    }

    pub async fn uptime_secs(&self) -> f64 {
        self.started_at.elapsed().as_secs_f64()
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
