use std::time::Duration;

use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderValue, Method, StatusCode},
    response::Json,
    routing::get,
    Router,
};
use serde::Deserialize;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use uuid::Uuid;

use crate::models::{
    ApiError, Experience, Health, MapData, MapMarker, MarkerKind, NewExperience, NewPerson, Person,
    ServiceInfo,
};
use crate::state::AppState;

pub fn router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin([
            HeaderValue::from_static("http://localhost:5173"),
            HeaderValue::from_static("http://127.0.0.1:5173"),
        ])
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION])
        .max_age(Duration::from_secs(3600));

    Router::new()
        .route("/", get(root))
        .route("/health", get(health))
        .route("/api/v1/people", get(list_people).post(create_person))
        .route("/api/v1/people/{id}", get(get_person))
        .route("/api/v1/experiences", get(list_experiences).post(create_experience))
        .route("/api/v1/experiences/{id}", get(get_experience))
        .route("/api/v1/map", get(get_map))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state)
}

// ---------- root & health ----------

async fn root() -> Json<ServiceInfo> {
    Json(ServiceInfo {
        name: "experience-people-identification-map backend",
        version: env!("CARGO_PKG_VERSION"),
        status: "ok",
        endpoints: vec![
            ("GET", "/"),
            ("GET", "/health"),
            ("GET", "/api/v1/people"),
            ("POST", "/api/v1/people"),
            ("GET", "/api/v1/people/{id}"),
            ("GET", "/api/v1/experiences"),
            ("POST", "/api/v1/experiences"),
            ("GET", "/api/v1/experiences/{id}"),
            ("GET", "/api/v1/map"),
        ],
    })
}

async fn health(State(state): State<AppState>) -> Json<Health> {
    Json(Health {
        status: "ok",
        uptime_secs: state.uptime_secs().await,
    })
}

// ---------- people ----------

async fn list_people(State(state): State<AppState>) -> Json<Vec<Person>> {
    let map = state.people.lock().await;
    let mut out: Vec<Person> = map.values().cloned().collect();
    out.sort_by_key(|p| p.created_at);
    Json(out)
}

async fn get_person(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Person>, ApiError> {
    let map = state.people.lock().await;
    map.get(&id).cloned().map(Json).ok_or(ApiError::NotFound)
}

async fn create_person(
    State(state): State<AppState>,
    Json(input): Json<NewPerson>,
) -> Result<(StatusCode, Json<Person>), ApiError> {
    validate_person(&input)?;
    let person = Person {
        id: Uuid::new_v4(),
        name: input.name.trim().to_string(),
        role: input.role.trim().to_string(),
        lat: input.lat,
        lng: input.lng,
        created_at: crate::models::now_secs(),
    };
    state.people.lock().await.insert(person.id, person.clone());
    Ok((StatusCode::CREATED, Json(person)))
}

fn validate_person(p: &NewPerson) -> Result<(), ApiError> {
    if p.name.trim().is_empty() {
        return Err(ApiError::BadRequest("name is required".into()));
    }
    if p.role.trim().is_empty() {
        return Err(ApiError::BadRequest("role is required".into()));
    }
    if !(-90.0..=90.0).contains(&p.lat) {
        return Err(ApiError::BadRequest("lat must be between -90 and 90".into()));
    }
    if !(-180.0..=180.0).contains(&p.lng) {
        return Err(ApiError::BadRequest("lng must be between -180 and 180".into()));
    }
    Ok(())
}

// ---------- experiences ----------

#[derive(Debug, Deserialize)]
struct ListExperiencesQuery {
    #[serde(default)]
    category: Option<String>,
}

async fn list_experiences(
    State(state): State<AppState>,
    Query(q): Query<ListExperiencesQuery>,
) -> Json<Vec<Experience>> {
    let map = state.experiences.lock().await;
    let mut out: Vec<Experience> = map
        .values()
        .filter(|e| match &q.category {
            Some(c) => e.category.eq_ignore_ascii_case(c),
            None => true,
        })
        .cloned()
        .collect();
    out.sort_by_key(|e| e.created_at);
    Json(out)
}

async fn get_experience(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Experience>, ApiError> {
    let map = state.experiences.lock().await;
    map.get(&id).cloned().map(Json).ok_or(ApiError::NotFound)
}

async fn create_experience(
    State(state): State<AppState>,
    Json(input): Json<NewExperience>,
) -> Result<(StatusCode, Json<Experience>), ApiError> {
    validate_experience(&input).await?;

    if let Some(pid) = input.person_id
        && !state.people.lock().await.contains_key(&pid)
    {
        return Err(ApiError::BadRequest(format!(
            "person_id {pid} does not exist"
        )));
    }

    let experience = Experience {
        id: Uuid::new_v4(),
        title: input.title.trim().to_string(),
        description: input.description.trim().to_string(),
        category: input.category.trim().to_string(),
        lat: input.lat,
        lng: input.lng,
        person_id: input.person_id,
        created_at: crate::models::now_secs(),
    };
    state
        .experiences
        .lock()
        .await
        .insert(experience.id, experience.clone());
    Ok((StatusCode::CREATED, Json(experience)))
}

async fn validate_experience(e: &NewExperience) -> Result<(), ApiError> {
    if e.title.trim().is_empty() {
        return Err(ApiError::BadRequest("title is required".into()));
    }
    if e.category.trim().is_empty() {
        return Err(ApiError::BadRequest("category is required".into()));
    }
    if !(-90.0..=90.0).contains(&e.lat) {
        return Err(ApiError::BadRequest("lat must be between -90 and 90".into()));
    }
    if !(-180.0..=180.0).contains(&e.lng) {
        return Err(ApiError::BadRequest("lng must be between -180 and 180".into()));
    }
    Ok(())
}

// ---------- map ----------

async fn get_map(State(state): State<AppState>) -> Json<MapData> {
    let people = state.people.lock().await;
    let experiences = state.experiences.lock().await;

    let mut markers: Vec<MapMarker> = Vec::with_capacity(people.len() + experiences.len());

    for p in people.values() {
        markers.push(MapMarker {
            kind: MarkerKind::Person,
            id: p.id,
            lat: p.lat,
            lng: p.lng,
            label: p.name.clone(),
            category: p.role.clone(),
        });
    }
    for e in experiences.values() {
        markers.push(MapMarker {
            kind: MarkerKind::Experience,
            id: e.id,
            lat: e.lat,
            lng: e.lng,
            label: e.title.clone(),
            category: e.category.clone(),
        });
    }

    Json(MapData {
        markers,
        people_count: people.len(),
        experiences_count: experiences.len(),
    })
}
