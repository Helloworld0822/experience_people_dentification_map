"""Detect only people using the COCO-pretrained YOLO26 detector."""

from __future__ import annotations

import argparse
from pathlib import Path

from ultralytics import YOLO

PERSON_CLASS_ID = 0


def parse_source(value: str) -> str | int:
    return int(value) if value.isdigit() else value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="YOLO26 person-only detector")
    parser.add_argument("source", help="Image/video path, directory, URL, or webcam index")
    parser.add_argument("--model", default="yolo26m.pt", help="YOLO26 weights")
    parser.add_argument("--conf", type=float, default=0.25, help="Confidence threshold")
    parser.add_argument("--imgsz", type=int, default=960, help="Inference image size")
    parser.add_argument("--device", default=None, help="Use 'mps' on Apple Silicon if desired")
    parser.add_argument("--show", action="store_true", help="Display results in a window")
    parser.add_argument("--no-save", action="store_true", help="Do not save annotated output")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    model = YOLO(args.model)
    predictions = model.predict(
        source=parse_source(args.source),
        classes=[PERSON_CLASS_ID],
        conf=args.conf,
        imgsz=args.imgsz,
        device=args.device,
        show=args.show,
        save=not args.no_save,
        project="runs/person",
        name=Path(args.model).stem,
        stream=True,
    )

    total = 0
    for index, result in enumerate(predictions, start=1):
        count = 0 if result.boxes is None else len(result.boxes)
        total += count
        print(f"[{index}] {result.path}: {count} person(s)")
    print(f"Total detections: {total}")


if __name__ == "__main__":
    main()
