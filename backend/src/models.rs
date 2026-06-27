use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Returns the current UNIX timestamp in milliseconds.
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Top-level groupings from the experience-center floor plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Zone {
    /// 학습 및 상담 공간 (Learning & Counseling)
    Learning,
    /// 여가 및 체험 공간 (Leisure & Experience)
    Leisure,
    /// 건강 · 운동 공간 (Health & Exercise)
    Health,
    /// 인지 · 여가 공간 (Cognitive & Care)
    Cognitive,
}

impl Zone {
    /// Korean label used in the UI.
    pub const fn label_ko(self) -> &'static str {
        match self {
            Zone::Learning => "학습 및 상담 공간",
            Zone::Leisure => "여가 및 체험 공간",
            Zone::Health => "건강 · 운동 공간",
            Zone::Cognitive => "인지 · 여가 공간",
        }
    }

    /// Theme color (Seoul Digital Companion Plaza design guide).
    /// These are darker variants for high contrast on white backgrounds.
    /// WCAG AAA compliant (7:1+ contrast ratio).
    pub const fn color(self) -> &'static str {
        match self {
            Zone::Learning => "#0047A0",  // Seoul Blue
            Zone::Leisure => "#92400E",   // Amber dark
            Zone::Health => "#166534",    // Green dark
            Zone::Cognitive => "#5B21B6", // Purple dark
        }
    }
}

/// A single space on the floor plan (the numbered regions in the image).
#[derive(Debug, Clone, Serialize)]
pub struct Space {
    /// Stable identifier, stable across restarts. Matches the badge number
    /// shown on the floor plan (1-10).
    pub id: u8,
    /// Grouping zone.
    pub zone: Zone,
    /// Short Korean title (e.g. "디지털 교육실").
    pub title_ko: String,
    /// English / romanised title.
    pub title_en: String,
    /// Single-line description shown in tooltips.
    pub description_ko: String,
    /// Floor-plan rectangle in viewBox units (0..=1000 wide, 0..=620 tall).
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    /// Optional pinned x,y for the number badge; if `None`, the badge is
    /// centred on the rectangle.
    pub badge_anchor: Option<(f32, f32)>,
}

/// Floor-plan payload returned by `GET /api/v1/floor`.
#[derive(Debug, Clone, Serialize)]
pub struct FloorData {
    /// ViewBox dimensions for the SVG.
    pub viewbox: ViewBox,
    /// Zone colour palette (id -> css color).
    pub zones: Vec<ZoneInfo>,
    /// All spaces laid out on the floor plan.
    pub spaces: Vec<Space>,
    /// Live people count per space, keyed by space id.
    pub counts: Vec<SpaceCount>,
    /// Wall-clock (ms) of this snapshot.
    pub generated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ViewBox {
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct ZoneInfo {
    pub id: Zone,
    pub label_ko: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpaceCount {
    pub space_id: u8,
    pub count: u32,
    pub updated_at_ms: i64,
}

/// Payload accepted by `POST /api/v1/spaces/{id}/count`.
#[derive(Debug, Clone, Deserialize)]
pub struct CountUpdate {
    pub count: u32,
}

/// AI detection record (camera + count + confidence). The same shape used
/// by the existing `/api/v1/detections` endpoints.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectionRecord {
    pub camera_id: String,
    pub space_id: Option<u8>,
    pub people_count: u32,
    pub confidence: Option<f32>,
    pub source: String,
    pub captured_at: Option<String>,
    pub received_at_ms: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DetectionInput {
    pub camera_id: Option<String>,
    pub space_id: Option<u8>,
    pub people_count: u32,
    pub confidence: Option<f32>,
    pub source: Option<String>,
    pub captured_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LatestDetectionResponse {
    pub detection: Option<DetectionRecord>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub uptime_secs: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ErrorBody {
    pub error: String,
}

/// Top-level API error type. Implements `IntoResponse` so handlers can
/// simply `?` propagate errors and the framework serializes a JSON body
/// with the right status code.
#[derive(Debug, Error)]
pub enum ApiError {
    #[error("resource not found")]
    NotFound,
    #[error("invalid request: {0}")]
    BadRequest(String),
    #[error("redis error: {0}")]
    Redis(#[from] redis::RedisError),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("internal error: {0}")]
    Internal(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            ApiError::NotFound => (StatusCode::NOT_FOUND, self.to_string()),
            ApiError::BadRequest(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            ApiError::Redis(_) | ApiError::Json(_) | ApiError::Internal(_) => {
                tracing::error!(error = %self, "internal error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal server error".to_string(),
                )
            }
        };
        (status, Json(ErrorBody { error: message })).into_response()
    }
}

/// Hard-coded floor plan, in viewBox 0 0 1000 620.
///
/// Coordinates are derived from the supplied illustration: the building
/// outline, the four zones, and the ten numbered spaces. Each space has a
/// stable `id` matching the badge in the image (1-10).
pub fn seed_floor() -> (ViewBox, Vec<Space>) {
    let viewbox = ViewBox {
        width: 1000.0,
        height: 620.0,
    };

    let spaces = vec![
        // 학습 및 상담 (top-left, blue)
        Space {
            id: 1,
            zone: Zone::Learning,
            title_ko: "디지털 교육실".to_string(),
            title_en: "Digital Classroom".to_string(),
            description_ko: "스마트폰 활용, 키오스크 사용법, 일상생활 디지털 기기 활용 등 수준별 맞춤 교육 진행".to_string(),
            x: 30.0,
            y: 40.0,
            width: 290.0,
            height: 220.0,
            badge_anchor: Some((75.0, 75.0)),
        },
        Space {
            id: 2,
            zone: Zone::Learning,
            title_ko: "디지털 상담존".to_string(),
            title_en: "Digital Counseling".to_string(),
            description_ko: "일상에서 마주하는 디지털 기기나 인터넷 사용 문제에 대해 1:1 맞춤형 전문 상담 지원".to_string(),
            x: 30.0,
            y: 290.0,
            width: 290.0,
            height: 290.0,
            badge_anchor: Some((75.0, 325.0)),
        },
        // 여가 및 체험 (centre, orange)
        Space {
            id: 3,
            zone: Zone::Leisure,
            title_ko: "무인 로봇 카페".to_string(),
            title_en: "Unmanned Robot Cafe".to_string(),
            description_ko: "로봇 바리스타가 직접 내려주는 커피를 마시며 휴식할 수 있는 공간".to_string(),
            x: 350.0,
            y: 40.0,
            width: 290.0,
            height: 200.0,
            badge_anchor: Some((550.0, 75.0)),
        },
        Space {
            id: 4,
            zone: Zone::Leisure,
            title_ko: "AI 로봇 바둑".to_string(),
            title_en: "AI Robot Baduk".to_string(),
            description_ko: "인공지능과 대국을 둘 수 있는 최신 디지털 기기 체험".to_string(),
            x: 350.0,
            y: 260.0,
            width: 290.0,
            height: 200.0,
            badge_anchor: Some((395.0, 295.0)),
        },
        // 건강 · 운동 (top-right, green)
        Space {
            id: 5,
            zone: Zone::Health,
            title_ko: "스크린 파크골프".to_string(),
            title_en: "Screen Park Golf".to_string(),
            description_ko: "실내에서 날씨와 관계없이 즐길 수 있는 스크린 스포츠 체험 시설".to_string(),
            x: 670.0,
            y: 40.0,
            width: 300.0,
            height: 230.0,
            badge_anchor: Some((720.0, 75.0)),
        },
        // 인지 · 여가 (right column, purple)
        Space {
            id: 6,
            zone: Zone::Cognitive,
            title_ko: "해피테이블, 멀티키움 등".to_string(),
            title_en: "Happy Table & Multi Kids".to_string(),
            description_ko: "인지 능력 향상과 두뇌 활동을 돕는 다양한 디지털 게임 및 어가 콘텐츠".to_string(),
            x: 670.0,
            y: 290.0,
            width: 300.0,
            height: 130.0,
            badge_anchor: Some((720.0, 325.0)),
        },
        // Bottom row: 7, 8, 9, 10
        Space {
            id: 7,
            zone: Zone::Cognitive,
            title_ko: "더브레인".to_string(),
            title_en: "The Brain".to_string(),
            description_ko: "두뇌 활동과 기억력, 집중력 항상 게임".to_string(),
            x: 670.0,
            y: 440.0,
            width: 70.0,
            height: 140.0,
            badge_anchor: Some((705.0, 470.0)),
        },
        Space {
            id: 8,
            zone: Zone::Cognitive,
            title_ko: "엑사하트".to_string(),
            title_en: "Exa Heart".to_string(),
            description_ko: "인지 능력 향상과 정서 안정, 스트레스 케어 콘텐츠 (인지·정서 케어)".to_string(),
            x: 740.0,
            y: 440.0,
            width: 70.0,
            height: 140.0,
            badge_anchor: Some((775.0, 470.0)),
        },
        Space {
            id: 9,
            zone: Zone::Cognitive,
            title_ko: "AI 포토 키오스크".to_string(),
            title_en: "AI Photo Kiosk".to_string(),
            description_ko: "AI 기술로 인생사진 촬영 및 즉시 사진 출력 (인생사진 촬영)".to_string(),
            x: 810.0,
            y: 440.0,
            width: 70.0,
            height: 140.0,
            badge_anchor: Some((845.0, 470.0)),
        },
        Space {
            id: 10,
            zone: Zone::Cognitive,
            title_ko: "AR 스포츠".to_string(),
            title_en: "AR Sports".to_string(),
            description_ko: "증강현실을 활용한 실감형 스포츠 체험 (가상 스포츠 체험)".to_string(),
            x: 880.0,
            y: 440.0,
            width: 90.0,
            height: 140.0,
            badge_anchor: Some((925.0, 470.0)),
        },
    ];

    (viewbox, spaces)
}

/// Canonical zone list, in display order (top → bottom, left → right).
pub fn zone_infos() -> Vec<ZoneInfo> {
    [
        Zone::Learning,
        Zone::Leisure,
        Zone::Health,
        Zone::Cognitive,
    ]
    .into_iter()
    .map(|z| ZoneInfo {
        id: z,
        label_ko: z.label_ko().to_string(),
        color: z.color().to_string(),
    })
    .collect()
}
