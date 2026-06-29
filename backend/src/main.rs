use std::env;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use axum::{
    Router,
    http::{Method, header},
    routing::{get, post},
};
use backend::{AppState, handlers};
use tokio::net::TcpListener;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let env_filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("backend=info,tower_http=info,info"));
    tracing_subscriber::registry()
        .with(env_filter)
        .with(tracing_subscriber::fmt::layer())
        .init();

    let bind_addr: SocketAddr = env::var("BIND_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:8080".to_string())
        .parse()?;
    let redis_url = env::var("REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:6379".to_string());
    let yolo_detect_url = env::var("YOLO_DETECT_URL")
        .unwrap_or_else(|_| "http://127.0.0.1:8765/api/v1/detect".to_string());

    let state = Arc::new(AppState::new(&redis_url, yolo_detect_url)?);

    // Allow LAN/mobile clients (phone on same Wi-Fi) to reach the API.
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION])
        .max_age(Duration::from_secs(3600));

    let app = Router::new()
        .route("/health", get(handlers::health))
        .route("/api/v1/floor", get(handlers::get_floor))
        .route("/api/v1/spaces/{id}/count", post(handlers::update_count))
        .route("/api/v1/spaces/{id}/stream", get(handlers::stream_space))
        .route("/api/v1/detections", post(handlers::create_detection))
        .route(
            "/api/v1/detections/infer",
            post(handlers::infer_and_create_detection),
        )
        .route("/api/v1/detections/latest", get(handlers::latest_detection))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state);

    let listener = TcpListener::bind(bind_addr).await?;
    tracing::info!("listening on http://{bind_addr}");

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        use tokio::signal::unix::{SignalKind, signal};
        if let Ok(mut s) = signal(SignalKind::terminate()) {
            s.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }
    tracing::info!("shutdown signal received");
}
