//! Camera source abstraction + synthetic MJPEG generator.
//!
//! In production this would wrap a real capture (V4L2 / AVFoundation /
//! Media Foundation). For the demo build we always render a synthetic
//! frame so the integration is verifiable on any machine without a
//! webcam. The synthetic source is driven by the same per-space count
//! that the rest of the system tracks in Redis, so the on-screen count
//! matches the dashboard.

use std::io::Cursor;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use image::codecs::jpeg::JpegEncoder;
use image::{ImageEncoder, Rgb, RgbImage};

use crate::models::SpaceCount;
use crate::state::AppState;

/// A single encoded JPEG frame plus the wall-clock time it was generated.
pub struct Frame {
    pub jpeg: Vec<u8>,
    pub captured_at_ms: i64,
}

/// Anything that can produce frames.
pub trait CameraSource: Send + Sync {
    fn name(&self) -> &'static str;
    fn width(&self) -> u32;
    fn height(&self) -> u32;
    /// Renders the next frame. Implementations should be cheap (a few
    /// hundred microseconds) since we call this in a tight loop.
    fn next_frame(&self, space_id: u8, count: u32) -> Frame;
}

/// Animated synthetic camera. Renders a 640x480 JPEG every call with:
/// - a tinted background whose hue depends on the space id
/// - the current people count drawn as coloured dots
/// - the space label + timestamp overlaid
pub struct SyntheticSource {
    width: u32,
    height: u32,
    started: Instant,
}

impl SyntheticSource {
    pub fn new() -> Self {
        Self {
            width: 640,
            height: 480,
            started: Instant::now(),
        }
    }
}

impl Default for SyntheticSource {
    fn default() -> Self {
        Self::new()
    }
}

impl CameraSource for SyntheticSource {
    fn name(&self) -> &'static str {
        "synthetic"
    }

    fn width(&self) -> u32 {
        self.width
    }

    fn height(&self) -> u32 {
        self.height
    }

    fn next_frame(&self, space_id: u8, count: u32) -> Frame {
        let t = self.started.elapsed().as_secs_f32();
        let img = render_frame(self.width, self.height, space_id, count, t);
        let jpeg = encode_jpeg(&img, 78);
        Frame {
            jpeg,
            captured_at_ms: now_ms(),
        }
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn encode_jpeg(img: &RgbImage, quality: u8) -> Vec<u8> {
    let mut buf = Vec::with_capacity(32 * 1024);
    {
        let writer = Cursor::new(&mut buf);
        // 78 is a good quality/size balance for live MJPEG.
        let enc = JpegEncoder::new_with_quality(writer, quality);
        enc.write_image(
            img.as_raw(),
            img.width(),
            img.height(),
            image::ExtendedColorType::Rgb8,
        )
        .expect("JPEG encode is infallible for a valid RGB image");
    }
    buf
}

fn render_frame(w: u32, h: u32, space_id: u8, count: u32, t: f32) -> RgbImage {
    let mut img = RgbImage::new(w, h);

    // Background: per-space hue, gently breathing.
    let base = hue_for_space(space_id);
    let breath = 0.85 + 0.15 * (t * 0.6).sin();
    let bg = darken(base, 0.18 * breath);
    fill(&mut img, bg);

    // Subtle scanlines so the feed looks like a live camera.
    for y in (0..h).step_by(3) {
        for x in 0..w {
            let p = img.get_pixel_mut(x, y);
            *p = Rgb([
                p[0].saturating_sub(8),
                p[1].saturating_sub(8),
                p[2].saturating_sub(8),
            ]);
        }
    }

    // People dots: arrange count circles in a 2-row grid.
    draw_people(&mut img, count, base, t);

    // Top-left badge: space id + count.
    draw_badge(&mut img, 14, 14, base, space_id, count);

    // Bottom strip: timestamp + source label.
    draw_status_bar(&mut img, w, h, space_id, t);

    img
}

fn fill(img: &mut RgbImage, color: Rgb<u8>) {
    for p in img.pixels_mut() {
        *p = color;
    }
}

fn darken(color: Rgb<u8>, factor: f32) -> Rgb<u8> {
    Rgb([
        (color[0] as f32 * factor) as u8,
        (color[1] as f32 * factor) as u8,
        (color[2] as f32 * factor) as u8,
    ])
}

fn hue_for_space(space_id: u8) -> Rgb<u8> {
    // Stable, zone-themed colour per space id (matches the floor palette).
    let zones: [Rgb<u8>; 10] = [
        Rgb([31, 111, 235]), // 1: learning
        Rgb([31, 111, 235]),
        Rgb([217, 119, 6]), // 3: leisure
        Rgb([217, 119, 6]),
        Rgb([31, 138, 60]),  // 5: health
        Rgb([124, 58, 237]), // 6: cognitive
        Rgb([124, 58, 237]),
        Rgb([124, 58, 237]),
        Rgb([124, 58, 237]),
        Rgb([124, 58, 237]),
    ];
    zones[((space_id - 1) as usize).min(zones.len() - 1)]
}

fn draw_people(img: &mut RgbImage, count: u32, accent: Rgb<u8>, t: f32) {
    let w = img.width();
    let h = img.height();
    let cols = 8u32;
    let rows = 5u32;
    let dot_r = 14u32;
    let pad_x = 70u32;
    let pad_y = 110u32;
    let step_x = (w - pad_x * 2) / cols.max(1);
    let step_y = (h - pad_y * 2) / rows.max(1);

    for i in 0..count.min(cols * rows) {
        let cx = pad_x + (i % cols) * step_x + step_x / 2;
        let cy = pad_y + (i / cols) * step_y + step_y / 2;
        // Gentle vertical bob so the dots look alive.
        let bob = ((t * 2.5 + i as f32 * 0.7).sin() * 3.0) as i32;
        let cy = (cy as i32 + bob).max(dot_r as i32) as u32;
        fill_circle(img, cx, cy, dot_r, accent);
        // Highlight
        fill_circle(img, cx - 3, cy - 3, 3, Rgb([255, 255, 255]));
    }
}

fn fill_circle(img: &mut RgbImage, cx: u32, cy: u32, r: u32, color: Rgb<u8>) {
    let r2 = (r as i32) * (r as i32);
    let w = img.width() as i32;
    let h = img.height() as i32;
    for y in (cy as i32 - r as i32)..=(cy as i32 + r as i32) {
        if y < 0 || y >= h {
            continue;
        }
        for x in (cx as i32 - r as i32)..=(cx as i32 + r as i32) {
            if x < 0 || x >= w {
                continue;
            }
            let dx = x - cx as i32;
            let dy = y - cy as i32;
            if dx * dx + dy * dy <= r2 {
                img.put_pixel(x as u32, y as u32, color);
            }
        }
    }
}

fn draw_badge(img: &mut RgbImage, x: u32, y: u32, color: Rgb<u8>, space_id: u8, count: u32) {
    // Solid rounded rectangle would need anti-aliasing; a simple block
    // reads as a HUD label without any extra deps.
    let bg = Rgb([20, 24, 28]);
    let label_w = 220u32;
    let label_h = 64u32;
    fill_rect(img, x, y, label_w, label_h, bg);
    fill_rect(img, x, y, 6, label_h, color);
    // Space id
    draw_text_blob(
        img,
        x + 18,
        y + 16,
        &format!("SPACE {}", space_id),
        Rgb([255, 255, 255]),
        2,
    );
    // Count
    draw_text_blob(
        img,
        x + 18,
        y + 40,
        &format!("{} people", count),
        Rgb([200, 210, 220]),
        1,
    );
}

fn draw_status_bar(img: &mut RgbImage, w: u32, h: u32, space_id: u8, t: f32) {
    let bar_h = 28u32;
    let y = h - bar_h;
    fill_rect(img, 0, y, w, bar_h, Rgb([20, 24, 28]));
    let secs = t as u32;
    let label = format!(
        "CAM space-{}  REC  {:02}:{:02}:{:02}  synthetic",
        space_id,
        (secs / 3600) % 24,
        (secs / 60) % 60,
        secs % 60
    );
    draw_text_blob(img, 12, y + 10, &label, Rgb([220, 220, 220]), 1);
}

fn fill_rect(img: &mut RgbImage, x: u32, y: u32, w: u32, h: u32, color: Rgb<u8>) {
    for yy in y..(y + h).min(img.height()) {
        for xx in x..(x + w).min(img.width()) {
            img.put_pixel(xx, yy, color);
        }
    }
}

/// Tiny bitmap text renderer. Each glyph is a hand-coded 5x7 grid so we
/// can label the synthetic feed without a font dep. Only ASCII letters,
/// digits, a few symbols, and a Korean fallback block are supported.
fn draw_text_blob(img: &mut RgbImage, x: u32, y: u32, text: &str, color: Rgb<u8>, scale: u32) {
    let mut cx = x as i32;
    for ch in text.chars() {
        if let Some(glyph) = glyph_for(ch) {
            for (gy, row) in glyph.iter().enumerate() {
                for (gx, bit) in row.iter().enumerate() {
                    if *bit == 1 {
                        for sy in 0..scale {
                            for sx in 0..scale {
                                let px = cx + gx as i32 * scale as i32 + sx as i32;
                                let py = y as i32 + gy as i32 * scale as i32 + sy as i32;
                                if px >= 0
                                    && py >= 0
                                    && (px as u32) < img.width()
                                    && (py as u32) < img.height()
                                {
                                    img.put_pixel(px as u32, py as u32, color);
                                }
                            }
                        }
                    }
                }
            }
            cx += (5 + 1) * scale as i32;
        } else {
            // Render CJK / unknown chars as a solid block so the layout
            // still advances — better than dropping the glyph entirely.
            fill_rect(img, cx.max(0) as u32, y, 5 * scale, 7 * scale, color);
            cx += (5 + 1) * scale as i32;
        }
    }
}

type Glyph = [[u8; 5]; 7];

fn glyph_for(ch: char) -> Option<Glyph> {
    let g: Glyph = match ch {
        'A' | 'a' => [
            [0, 1, 1, 1, 0],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 1, 1, 1, 1],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
        ],
        'B' | 'b' => [
            [1, 1, 1, 1, 0],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 1, 1, 1, 0],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 1, 1, 1, 0],
        ],
        'C' | 'c' => [
            [0, 1, 1, 1, 1],
            [1, 0, 0, 0, 0],
            [1, 0, 0, 0, 0],
            [1, 0, 0, 0, 0],
            [1, 0, 0, 0, 0],
            [1, 0, 0, 0, 0],
            [0, 1, 1, 1, 1],
        ],
        'D' | 'd' => [
            [1, 1, 1, 1, 0],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 1, 1, 1, 0],
        ],
        'E' | 'e' => [
            [1, 1, 1, 1, 1],
            [1, 0, 0, 0, 0],
            [1, 0, 0, 0, 0],
            [1, 1, 1, 1, 0],
            [1, 0, 0, 0, 0],
            [1, 0, 0, 0, 0],
            [1, 1, 1, 1, 1],
        ],
        'F' | 'f' => [
            [1, 1, 1, 1, 1],
            [1, 0, 0, 0, 0],
            [1, 0, 0, 0, 0],
            [1, 1, 1, 1, 0],
            [1, 0, 0, 0, 0],
            [1, 0, 0, 0, 0],
            [1, 0, 0, 0, 0],
        ],
        'G' | 'g' => [
            [0, 1, 1, 1, 1],
            [1, 0, 0, 0, 0],
            [1, 0, 0, 0, 0],
            [1, 0, 1, 1, 1],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [0, 1, 1, 1, 1],
        ],
        'H' | 'h' => [
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 1, 1, 1, 1],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
        ],
        'I' | 'i' => [
            [1, 1, 1, 1, 1],
            [0, 0, 1, 0, 0],
            [0, 0, 1, 0, 0],
            [0, 0, 1, 0, 0],
            [0, 0, 1, 0, 0],
            [0, 0, 1, 0, 0],
            [1, 1, 1, 1, 1],
        ],
        'L' | 'l' => [
            [1, 0, 0, 0, 0],
            [1, 0, 0, 0, 0],
            [1, 0, 0, 0, 0],
            [1, 0, 0, 0, 0],
            [1, 0, 0, 0, 0],
            [1, 0, 0, 0, 0],
            [1, 1, 1, 1, 1],
        ],
        'M' | 'm' => [
            [1, 0, 0, 0, 1],
            [1, 1, 0, 1, 1],
            [1, 0, 1, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
        ],
        'N' | 'n' => [
            [1, 0, 0, 0, 1],
            [1, 1, 0, 0, 1],
            [1, 0, 1, 0, 1],
            [1, 0, 0, 1, 1],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
        ],
        'O' | 'o' => [
            [0, 1, 1, 1, 0],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [0, 1, 1, 1, 0],
        ],
        'P' | 'p' => [
            [1, 1, 1, 1, 0],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 1, 1, 1, 0],
            [1, 0, 0, 0, 0],
            [1, 0, 0, 0, 0],
            [1, 0, 0, 0, 0],
        ],
        'R' | 'r' => [
            [1, 1, 1, 1, 0],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 1, 1, 1, 0],
            [1, 0, 1, 0, 0],
            [1, 0, 0, 1, 0],
            [1, 0, 0, 0, 1],
        ],
        'S' | 's' => [
            [0, 1, 1, 1, 1],
            [1, 0, 0, 0, 0],
            [1, 0, 0, 0, 0],
            [0, 1, 1, 1, 0],
            [0, 0, 0, 0, 1],
            [0, 0, 0, 0, 1],
            [1, 1, 1, 1, 0],
        ],
        'T' | 't' => [
            [1, 1, 1, 1, 1],
            [0, 0, 1, 0, 0],
            [0, 0, 1, 0, 0],
            [0, 0, 1, 0, 0],
            [0, 0, 1, 0, 0],
            [0, 0, 1, 0, 0],
            [0, 0, 1, 0, 0],
        ],
        'U' | 'u' => [
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [0, 1, 1, 1, 0],
        ],
        'V' | 'v' => [
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [0, 1, 0, 1, 0],
            [0, 0, 1, 0, 0],
        ],
        'W' | 'w' => [
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [1, 0, 1, 0, 1],
            [1, 1, 0, 1, 1],
            [1, 0, 0, 0, 1],
        ],
        'Y' | 'y' => [
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [0, 1, 0, 1, 0],
            [0, 0, 1, 0, 0],
            [0, 0, 1, 0, 0],
            [0, 0, 1, 0, 0],
            [0, 0, 1, 0, 0],
        ],
        '0' => [
            [0, 1, 1, 1, 0],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 1, 1],
            [1, 0, 1, 0, 1],
            [1, 1, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [0, 1, 1, 1, 0],
        ],
        '1' => [
            [0, 0, 1, 0, 0],
            [0, 1, 1, 0, 0],
            [0, 0, 1, 0, 0],
            [0, 0, 1, 0, 0],
            [0, 0, 1, 0, 0],
            [0, 0, 1, 0, 0],
            [1, 1, 1, 1, 1],
        ],
        '2' => [
            [0, 1, 1, 1, 0],
            [1, 0, 0, 0, 1],
            [0, 0, 0, 0, 1],
            [0, 0, 0, 1, 0],
            [0, 0, 1, 0, 0],
            [0, 1, 0, 0, 0],
            [1, 1, 1, 1, 1],
        ],
        '3' => [
            [0, 1, 1, 1, 0],
            [1, 0, 0, 0, 1],
            [0, 0, 0, 0, 1],
            [0, 0, 1, 1, 0],
            [0, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [0, 1, 1, 1, 0],
        ],
        '4' => [
            [0, 0, 0, 1, 0],
            [0, 0, 1, 1, 0],
            [0, 1, 0, 1, 0],
            [1, 0, 0, 1, 0],
            [1, 1, 1, 1, 1],
            [0, 0, 0, 1, 0],
            [0, 0, 0, 1, 0],
        ],
        '5' => [
            [1, 1, 1, 1, 1],
            [1, 0, 0, 0, 0],
            [1, 1, 1, 1, 0],
            [0, 0, 0, 0, 1],
            [0, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [0, 1, 1, 1, 0],
        ],
        '6' => [
            [0, 1, 1, 1, 0],
            [1, 0, 0, 0, 0],
            [1, 0, 0, 0, 0],
            [1, 1, 1, 1, 0],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [0, 1, 1, 1, 0],
        ],
        '7' => [
            [1, 1, 1, 1, 1],
            [0, 0, 0, 0, 1],
            [0, 0, 0, 1, 0],
            [0, 0, 1, 0, 0],
            [0, 0, 1, 0, 0],
            [0, 1, 0, 0, 0],
            [0, 1, 0, 0, 0],
        ],
        '8' => [
            [0, 1, 1, 1, 0],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [0, 1, 1, 1, 0],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [0, 1, 1, 1, 0],
        ],
        '9' => [
            [0, 1, 1, 1, 0],
            [1, 0, 0, 0, 1],
            [1, 0, 0, 0, 1],
            [0, 1, 1, 1, 1],
            [0, 0, 0, 0, 1],
            [0, 0, 0, 0, 1],
            [0, 1, 1, 1, 0],
        ],
        ' ' => [
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0],
        ],
        ':' => [
            [0, 0, 0, 0, 0],
            [0, 0, 1, 0, 0],
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0],
            [0, 0, 1, 0, 0],
            [0, 0, 0, 0, 0],
        ],
        '-' => [
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0],
            [1, 1, 1, 1, 1],
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0],
        ],
        '/' => [
            [0, 0, 0, 0, 1],
            [0, 0, 0, 1, 0],
            [0, 0, 1, 0, 0],
            [0, 0, 1, 0, 0],
            [0, 0, 1, 0, 0],
            [0, 0, 1, 0, 0],
            [0, 1, 0, 0, 0],
        ],
        _ => return None,
    };
    Some(g)
}

/// Fetch the latest known count for `space_id` from Redis, or 0.
///
/// Results are cached in-process for 200ms to avoid hammering Redis
/// when several browsers are connected to the same camera stream.
/// The cache is intentionally short so manual count changes still
/// show up within a couple of frames.
pub async fn current_count(state: &AppState, space_id: u8) -> u32 {
    use std::sync::OnceLock;
    use std::time::{Duration, Instant};
    use tokio::sync::Mutex;

    // One tiny cache per (process, space). The Mutex is uncontended
    // most of the time and the inner state is two `u8`s plus a timestamp.
    struct Entry {
        count: u32,
        at: Instant,
    }
    static CACHE: OnceLock<Mutex<std::collections::HashMap<u8, Entry>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(Default::default()));

    {
        let guard = cache.lock().await;
        if let Some(entry) = guard.get(&space_id)
            && entry.at.elapsed() < Duration::from_millis(200)
        {
            return entry.count;
        }
    }

    // Cache miss: hit Redis.
    let count = fetch_count_from_redis(state, space_id).await;

    let mut guard = cache.lock().await;
    guard.insert(
        space_id,
        Entry {
            count,
            at: Instant::now(),
        },
    );
    count
}

async fn fetch_count_from_redis(state: &AppState, space_id: u8) -> u32 {
    let mut conn = match state.redis.get_multiplexed_async_connection().await {
        Ok(c) => c,
        Err(_) => return 0,
    };
    use redis::AsyncCommands;
    let key = crate::store::space_count_key_str(space_id);
    let payload: Option<String> = conn.get(&key).await.unwrap_or(None);
    payload
        .and_then(|p| serde_json::from_str::<SpaceCount>(&p).ok())
        .map(|c| c.count)
        .unwrap_or(0)
}
