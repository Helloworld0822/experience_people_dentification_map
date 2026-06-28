"""Local web app for real-time browser camera person detection."""

from __future__ import annotations

import argparse
import base64
import binascii
import math
import os
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated

import cv2
import numpy as np
import torch
import uvicorn
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "web"
MODEL_NAME = os.getenv("YOLO_MODEL", "yolo26m.pt")
MODEL_PATH = ROOT / MODEL_NAME
INFERENCE_SIZE = int(os.getenv("YOLO_IMGSZ", "960"))
PERSON_CLASS_ID = 0
MAX_FRAME_BYTES = 8 * 1024 * 1024
MODEL_IOU = float(os.getenv("YOLO_IOU", "0.6"))
MAX_DETECTIONS = int(os.getenv("YOLO_MAX_DETECTIONS", "80"))
MIN_PERSON_AREA_RATIO = float(os.getenv("YOLO_MIN_PERSON_AREA_RATIO", "0.004"))
MIN_PERSON_HEIGHT_RATIO = float(os.getenv("YOLO_MIN_PERSON_HEIGHT_RATIO", "0.07"))
MAX_TALL_THIN_RATIO = float(os.getenv("YOLO_MAX_TALL_THIN_RATIO", "4.8"))
MIN_WIDE_SHORT_RATIO = float(os.getenv("YOLO_MIN_WIDE_SHORT_RATIO", "0.22"))
DENSITY_MIN_RADIUS_RATIO = float(os.getenv("DENSITY_MIN_RADIUS_RATIO", "0.045"))
DENSITY_MAX_RADIUS_RATIO = float(os.getenv("DENSITY_MAX_RADIUS_RATIO", "0.16"))
DENSITY_WIDTH_MULTIPLIER = float(os.getenv("DENSITY_WIDTH_MULTIPLIER", "1.45"))
DENSITY_HEIGHT_MULTIPLIER = float(os.getenv("DENSITY_HEIGHT_MULTIPLIER", "0.38"))
DENSITY_HIGH_COUNT = float(os.getenv("DENSITY_HIGH_COUNT", "14"))

_model: YOLO | None = None
_model_lock = threading.RLock()
_device = "mps" if torch.backends.mps.is_available() else "cpu"
_live_frame_lock = threading.RLock()
_live_frame_jpeg: bytes | None = None
_live_frame_updated_at = 0.0


class JsonDetectionRequest(BaseModel):
    """Base64-encoded image request for application-to-application calls."""

    image_base64: str = Field(
        min_length=4,
        description="Base64 image data, with or without a data:image/...;base64, prefix.",
    )
    confidence: float = Field(default=0.55, ge=0.05, le=0.95)
    dense_mode: bool = Field(
        default=True,
        description="Run overlapping tile inference to improve small and crowded-person recall.",
    )
    request_id: str | None = Field(default=None, max_length=128)


class CctvDetectionRequest(BaseModel):
    """RTSP/HTTP CCTV stream request for server-side snapshot analysis."""

    stream_url: str = Field(
        min_length=8,
        max_length=2048,
        description="CCTV stream URL, usually rtsp://user:password@camera-ip:554/...",
    )
    confidence: float = Field(default=0.55, ge=0.05, le=0.95)
    dense_mode: bool = Field(default=True)
    request_id: str | None = Field(default=None, max_length=128)


class DetectionBox(BaseModel):
    class_id: int = 0
    label: str = "person"
    confidence: float
    x1: float
    y1: float
    x2: float
    y2: float


class DensityPair(BaseModel):
    from_index: int
    to_index: int
    dx: float
    dy: float
    distance: float
    normalized_distance: float


class ObjectDensity(BaseModel):
    index: int
    center_x: float
    center_y: float
    nearest_distance: float | None
    neighbor_count: int
    local_density: float


class DensitySummary(BaseModel):
    score: float
    level: str
    radius_px: float
    average_distance: float | None
    min_distance: float | None
    objects: list[ObjectDensity]
    pairs: list[DensityPair]


class DetectionResponse(BaseModel):
    request_id: str | None = None
    width: int
    height: int
    count: int
    boxes: list[DetectionBox]
    inference_ms: float
    model: str
    inference_size: int
    detection_mode: str
    inference_passes: int
    device: str
    density: DensitySummary


def get_model() -> YOLO:
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                _model = YOLO(str(MODEL_PATH))
    return _model


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Load weights at startup so the first camera frame is not delayed."""
    get_model()
    yield


app = FastAPI(
    title="YOLO26 Person Detector",
    description="Local person-detection API powered by YOLO26.",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)
app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


@app.get("/api/health", tags=["system"])
@app.get("/api/v1/health", tags=["system"])
def health() -> dict[str, str | bool | int]:
    return {
        "status": "ready",
        "model": MODEL_PATH.name,
        "inference_size": INFERENCE_SIZE,
        "dense_mode": False,
        "device": _device,
        "mps": torch.backends.mps.is_available(),
    }


def decode_image(image_bytes: bytes) -> np.ndarray:
    if not image_bytes or len(image_bytes) > MAX_FRAME_BYTES:
        raise HTTPException(status_code=400, detail="Invalid frame size")

    frame = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Could not decode image")
    return frame


def set_live_frame(image_bytes: bytes) -> None:
    """Store a sanitized live frame uploaded from the browser camera page."""
    global _live_frame_jpeg, _live_frame_updated_at
    frame = decode_image(image_bytes)
    ok, encoded = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
    if not ok:
        raise HTTPException(status_code=400, detail="Could not encode live frame")
    with _live_frame_lock:
        _live_frame_jpeg = encoded.tobytes()
        _live_frame_updated_at = time.time()


def clear_live_frame() -> None:
    global _live_frame_jpeg, _live_frame_updated_at
    with _live_frame_lock:
        _live_frame_jpeg = None
        _live_frame_updated_at = 0.0


def get_live_frame_snapshot() -> tuple[bytes | None, float]:
    with _live_frame_lock:
        return _live_frame_jpeg, _live_frame_updated_at


def decode_cctv_snapshot(stream_url: str) -> np.ndarray:
    """Read a single frame from an RTSP/HTTP CCTV stream."""
    url = stream_url.strip()
    if not url.startswith(("rtsp://", "http://", "https://")):
        raise HTTPException(
            status_code=400,
            detail="CCTV stream_url must start with rtsp://, http://, or https://",
        )

    capture = cv2.VideoCapture(url)
    if hasattr(cv2, "CAP_PROP_OPEN_TIMEOUT_MSEC"):
        capture.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000)
    if hasattr(cv2, "CAP_PROP_READ_TIMEOUT_MSEC"):
        capture.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000)

    try:
        ok, frame = capture.read()
    finally:
        capture.release()

    if not ok or frame is None:
        raise HTTPException(
            status_code=502,
            detail="Could not read a frame from the CCTV stream",
        )
    return frame


def intersection_metrics(a: dict, b: dict) -> tuple[float, float]:
    intersection_width = max(0.0, min(a["x2"], b["x2"]) - max(a["x1"], b["x1"]))
    intersection_height = max(0.0, min(a["y2"], b["y2"]) - max(a["y1"], b["y1"]))
    intersection = intersection_width * intersection_height
    area_a = max(1.0, (a["x2"] - a["x1"]) * (a["y2"] - a["y1"]))
    area_b = max(1.0, (b["x2"] - b["x1"]) * (b["y2"] - b["y1"]))
    union = area_a + area_b - intersection
    return intersection / max(union, 1.0), intersection / min(area_a, area_b)


def remove_duplicate_boxes(candidates: list[dict]) -> list[dict]:
    """Final lightweight NMS. YOLO already filters most boxes; this catches leftovers."""
    kept: list[dict] = []
    for candidate in sorted(candidates, key=lambda item: item["confidence"], reverse=True):
        duplicate = False
        for existing in kept:
            iou, smaller_overlap = intersection_metrics(candidate, existing)
            if iou >= 0.55 or smaller_overlap >= 0.78:
                duplicate = True
                break
        if not duplicate:
            kept.append(candidate)
    return kept


def person_box_area_ratio(box: dict, frame_width: int, frame_height: int) -> float:
    width = max(1.0, box["x2"] - box["x1"])
    height = max(1.0, box["y2"] - box["y1"])
    return (width * height) / max(1.0, frame_width * frame_height)


def is_plausible_person_box(box: dict, frame_width: int, frame_height: int) -> bool:
    """Filter obvious false positives without trying to be too clever."""
    width = max(1.0, box["x2"] - box["x1"])
    height = max(1.0, box["y2"] - box["y1"])
    area_ratio = person_box_area_ratio(box, frame_width, frame_height)
    aspect = height / width

    if area_ratio < MIN_PERSON_AREA_RATIO:
        return False
    if height < frame_height * MIN_PERSON_HEIGHT_RATIO and area_ratio < 0.02:
        return False
    if aspect > MAX_TALL_THIN_RATIO:
        return False
    if aspect < MIN_WIDE_SHORT_RATIO:
        return False
    return True


def density_level(score: float, count: int) -> str:
    if count <= 1:
        return "empty" if count == 0 else "single"
    if score >= 82:
        return "crowded"
    if score >= 58:
        return "dense"
    if score >= 30:
        return "normal"
    return "sparse"


def median(values: list[float]) -> float:
    if not values:
        return 0.0
    sorted_values = sorted(values)
    middle = len(sorted_values) // 2
    if len(sorted_values) % 2:
        return sorted_values[middle]
    return (sorted_values[middle - 1] + sorted_values[middle]) / 2.0


def calculate_box_density(
    boxes: list[dict], frame_width: int, frame_height: int
) -> DensitySummary:
    """Calculate density from each person's floor-contact anchor point."""
    anchors = [
        ((box["x1"] + box["x2"]) / 2.0, box["y2"])
        for box in boxes
    ]
    widths = [max(1.0, box["x2"] - box["x1"]) for box in boxes]
    heights = [max(1.0, box["y2"] - box["y1"]) for box in boxes]
    count = len(anchors)
    diagonal = math.hypot(frame_width, frame_height)
    adaptive_radius = max(
        median(widths) * DENSITY_WIDTH_MULTIPLIER,
        median(heights) * DENSITY_HEIGHT_MULTIPLIER,
        diagonal * DENSITY_MIN_RADIUS_RATIO,
    )
    radius_px = min(
        max(1.0, adaptive_radius),
        max(1.0, diagonal * DENSITY_MAX_RADIUS_RATIO),
    )
    neighbor_counts = [0 for _ in anchors]
    density_scores = [0.0 for _ in anchors]
    nearest_distances: list[float | None] = [None for _ in anchors]
    distances: list[float] = []
    pairs: list[DensityPair] = []

    for from_index in range(count):
        from_x, from_y = anchors[from_index]
        for to_index in range(from_index + 1, count):
            to_x, to_y = anchors[to_index]
            dx = to_x - from_x
            dy = to_y - from_y
            distance = math.hypot(dx, dy)
            normalized_distance = distance / diagonal if diagonal else 0.0
            distances.append(distance)
            pairs.append(
                DensityPair(
                    from_index=from_index,
                    to_index=to_index,
                    dx=round(dx, 2),
                    dy=round(dy, 2),
                    distance=round(distance, 2),
                    normalized_distance=round(normalized_distance, 4),
                )
            )

            for index in (from_index, to_index):
                current_nearest = nearest_distances[index]
                if current_nearest is None or distance < current_nearest:
                    nearest_distances[index] = distance

            if distance <= radius_px:
                contribution = 1.0 - (distance / radius_px) ** 1.15
                neighbor_counts[from_index] += 1
                neighbor_counts[to_index] += 1
                density_scores[from_index] += contribution
                density_scores[to_index] += contribution

    objects: list[ObjectDensity] = []
    local_scores: list[float] = []
    denominator = max(1, min(2, count - 1))
    for index, (center_x, center_y) in enumerate(anchors):
        local_density = min(100.0, (density_scores[index] / denominator) * 100.0)
        local_scores.append(local_density)
        objects.append(
            ObjectDensity(
                index=index,
                center_x=round(center_x, 2),
                center_y=round(center_y, 2),
                nearest_distance=(
                    round(nearest_distances[index], 2)
                    if nearest_distances[index] is not None
                    else None
                ),
                neighbor_count=neighbor_counts[index],
                local_density=round(local_density, 1),
            )
        )

    proximity_score = sum(local_scores) / count if count else 0.0
    count_score = min(100.0, (count / DENSITY_HIGH_COUNT) * 100.0)
    if count >= 2:
        min_x = min(anchor[0] for anchor in anchors)
        max_x = max(anchor[0] for anchor in anchors)
        min_y = min(anchor[1] for anchor in anchors)
        max_y = max(anchor[1] for anchor in anchors)
        occupied_area_ratio = max(
            0.04,
            ((max_x - min_x) * (max_y - min_y)) / max(1.0, frame_width * frame_height),
        )
        cluster_score = min(100.0, (count / (DENSITY_HIGH_COUNT * occupied_area_ratio)) * 55.0)
    else:
        cluster_score = 0.0

    # Camera frames without floor calibration need both local proximity and crowd pressure.
    score = max(proximity_score, (proximity_score * 0.35) + (count_score * 0.30) + (cluster_score * 0.35))
    return DensitySummary(
        score=round(score, 1),
        level=density_level(score, count),
        radius_px=round(radius_px, 2),
        average_distance=round(sum(distances) / len(distances), 2) if distances else None,
        min_distance=round(min(distances), 2) if distances else None,
        objects=objects,
        pairs=pairs,
    )


def predict_person_boxes(frame: np.ndarray, confidence: float) -> list[dict]:
    """Run one full-frame YOLO pass and return cleaned person boxes."""
    frame_height, frame_width = frame.shape[:2]
    result = get_model().predict(
        frame,
        classes=[PERSON_CLASS_ID],
        conf=confidence,
        iou=MODEL_IOU,
        max_det=MAX_DETECTIONS,
        imgsz=INFERENCE_SIZE,
        device=_device,
        verbose=False,
    )[0]
    if result.boxes is None:
        return []

    candidates: list[dict] = []
    xyxy = result.boxes.xyxy.cpu().tolist()
    scores = result.boxes.conf.cpu().tolist()
    for coords, score in zip(xyxy, scores, strict=True):
        x1, y1, x2, y2 = coords
        candidate = {
            "class_id": PERSON_CLASS_ID,
            "label": "person",
            "x1": round(max(0.0, x1), 1),
            "y1": round(max(0.0, y1), 1),
            "x2": round(min(float(frame_width), x2), 1),
            "y2": round(min(float(frame_height), y2), 1),
            "confidence": round(float(score), 3),
        }
        if is_plausible_person_box(candidate, frame_width, frame_height):
            candidates.append(candidate)

    return remove_duplicate_boxes(candidates)


def run_detection(
    frame: np.ndarray,
    confidence: float,
    request_id: str | None = None,
    dense_mode: bool = True,
) -> DetectionResponse:
    started = time.perf_counter()
    with _model_lock:
        boxes = predict_person_boxes(frame, confidence)

    return DetectionResponse(
        request_id=request_id,
        width=frame.shape[1],
        height=frame.shape[0],
        count=len(boxes),
        boxes=boxes,
        inference_ms=round((time.perf_counter() - started) * 1000, 1),
        model=MODEL_PATH.name,
        inference_size=INFERENCE_SIZE,
        detection_mode="single_frame",
        inference_passes=1,
        device=_device,
        density=calculate_box_density(boxes, frame.shape[1], frame.shape[0]),
    )


@app.post(
    "/api/detect",
    response_model=DetectionResponse,
    tags=["detection"],
    summary="Detect people from raw image bytes",
)
async def detect(
    request: Request,
    conf: Annotated[float, Query(ge=0.05, le=0.95)] = 0.5,
    dense: bool = True,
) -> DetectionResponse:
    """Endpoint used by the browser camera page (JPEG/PNG request body)."""
    return run_detection(decode_image(await request.body()), conf, dense_mode=dense)


@app.post(
    "/api/v1/detect",
    response_model=DetectionResponse,
    tags=["detection"],
    summary="Detect people from a JSON Base64 image",
)
def detect_json(payload: JsonDetectionRequest) -> DetectionResponse:
    """Stable JSON API for external applications."""
    encoded = payload.image_base64.strip()
    if encoded.startswith("data:"):
        if "," not in encoded:
            raise HTTPException(status_code=400, detail="Invalid image data URL")
        encoded = encoded.split(",", 1)[1]

    try:
        image_bytes = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Invalid Base64 image") from exc

    return run_detection(
        decode_image(image_bytes),
        payload.confidence,
        payload.request_id,
        payload.dense_mode,
    )


@app.post(
    "/api/v1/cctv/detect",
    response_model=DetectionResponse,
    tags=["detection"],
    summary="Detect people from a CCTV RTSP/HTTP snapshot",
)
def detect_cctv(payload: CctvDetectionRequest) -> DetectionResponse:
    """Server-side CCTV analysis so RTSP credentials stay out of the browser."""
    return run_detection(
        decode_cctv_snapshot(payload.stream_url),
        payload.confidence,
        payload.request_id,
        payload.dense_mode,
    )


@app.post("/api/v1/live/frame", status_code=204, tags=["stream"])
async def upload_live_frame(request: Request) -> Response:
    """Receive a browser camera frame to rebroadcast for external viewers."""
    set_live_frame(await request.body())
    return Response(status_code=204)


@app.post("/api/v1/live/clear", status_code=204, tags=["stream"])
def clear_live_stream_frame() -> Response:
    clear_live_frame()
    return Response(status_code=204)


@app.get("/api/v1/live/frame", tags=["stream"])
def get_live_frame() -> Response:
    frame, _ = get_live_frame_snapshot()
    if frame is None:
        raise HTTPException(status_code=404, detail="No live camera frame available yet")
    return Response(
        content=frame,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
    )


def live_stream_generator():
    last_sent_at = 0.0
    while True:
        frame, updated_at = get_live_frame_snapshot()
        if frame is None or updated_at <= last_sent_at:
            time.sleep(0.08)
            continue

        last_sent_at = updated_at
        header = (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n"
            + f"Content-Length: {len(frame)}\r\n\r\n".encode("ascii")
        )
        yield header + frame + b"\r\n"


@app.get("/api/v1/live/stream", tags=["stream"])
def get_live_stream() -> StreamingResponse:
    return StreamingResponse(
        live_stream_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"},
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="YOLO26 camera detection web app")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    uvicorn.run(app, host=args.host, port=args.port, access_log=False)


if __name__ == "__main__":
    main()
