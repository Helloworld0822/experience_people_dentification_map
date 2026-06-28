"""Run YOLO26 object detection on an image, video, directory, URL, or webcam."""

from __future__ import annotations

import argparse
from pathlib import Path

from ultralytics import YOLO


def parse_source(value: str) -> str | int:
    """Convert a numeric camera index such as '0' to an integer."""
    return int(value) if value.isdigit() else value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="YOLO26 object detection")
    parser.add_argument("source", help="Image/video path, directory, URL, or webcam index")
    parser.add_argument("--model", default="yolo26m.pt", help="Model weights")
    parser.add_argument("--conf", type=float, default=0.25, help="Confidence threshold")
    parser.add_argument("--imgsz", type=int, default=960, help="Inference image size")
    parser.add_argument(
        "--classes",
        nargs="+",
        type=int,
        default=None,
        help="Optional COCO class IDs to keep, e.g. 0 for person",
    )
    parser.add_argument("--device", default=None, help="cpu, mps, 0, etc. (default: auto)")
    parser.add_argument("--show", action="store_true", help="Display results in a window")
    parser.add_argument("--no-save", action="store_true", help="Do not save annotated output")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    model = YOLO(args.model)
    predictions = model.predict(
        source=parse_source(args.source),
        conf=args.conf,
        imgsz=args.imgsz,
        classes=args.classes,
        device=args.device,
        show=args.show,
        save=not args.no_save,
        project="runs/detect",
        name=Path(args.model).stem,
        stream=True,
    )

    for index, result in enumerate(predictions, start=1):
        count = 0 if result.boxes is None else len(result.boxes)
        print(f"[{index}] {result.path}: {count} object(s)")


if __name__ == "__main__":
    main()
