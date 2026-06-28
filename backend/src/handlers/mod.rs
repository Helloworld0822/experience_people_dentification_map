mod camera;
mod detections;
mod health;
mod spaces;

pub use camera::stream_space;
pub use detections::{create_detection, infer_and_create_detection, latest_detection};
pub use health::health;
pub use spaces::{get_floor, update_count};
