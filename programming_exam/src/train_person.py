"""Fine-tune YOLO26 for a custom single-class person dataset."""

from __future__ import annotations

import argparse

from ultralytics import YOLO


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Train a YOLO26 person detector")
    parser.add_argument("--data", default="configs/person.yaml", help="Dataset YAML")
    parser.add_argument("--model", default="yolo26m.pt", help="Starting weights")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=8)
    parser.add_argument("--device", default=None, help="cpu, mps, 0, etc. (default: auto)")
    parser.add_argument("--workers", type=int, default=4)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    model = YOLO(args.model)
    model.train(
        data=args.data,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=args.device,
        workers=args.workers,
        project="runs/train",
        name="yolo26-person",
        exist_ok=True,
    )


if __name__ == "__main__":
    main()
