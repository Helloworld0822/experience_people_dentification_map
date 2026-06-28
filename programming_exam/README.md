# YOLO26 객체·사람 탐지

Ultralytics YOLO26으로 일반 객체를 탐지하고, COCO의 `person` 클래스만 골라 탐지하거나
사용자 데이터로 사람 전용 모델을 미세조정하는 프로젝트입니다.

## 설치

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

기본 모델인 `yolo26m.pt`는 첫 실행 때 공식 Ultralytics 릴리스에서 자동으로 내려받습니다.

## 바로 실행

일반 객체 탐지:

```bash
.venv/bin/python src/detect.py path/to/image.jpg
```

사람만 탐지:

```bash
.venv/bin/python src/person_detector.py path/to/image.jpg
```

웹캠에서 사람만 탐지:

```bash
.venv/bin/python src/person_detector.py 0 --show --device mps
```

결과는 기본적으로 `runs/` 아래에 저장됩니다. 저장하지 않으려면 `--no-save`를 붙입니다.
속도보다 정확도를 우선하면 `--model yolo26l.pt` 또는 더 큰 모델을 사용할 수 있습니다.

## 사람 전용 모델 학습

이미지와 YOLO 형식 라벨을 다음 위치에 넣습니다.

```text
datasets/person/
├── images/
│   ├── train/
│   └── val/
└── labels/
    ├── train/
    └── val/
```

각 라벨 파일의 한 줄 형식은 아래와 같습니다. 클래스 ID는 사람 하나뿐이므로 항상 `0`입니다.

```text
0 x_center y_center width height
```

좌표와 크기는 이미지 너비·높이에 대해 0~1로 정규화해야 합니다.

학습 실행:

```bash
.venv/bin/python src/train_person.py --device mps
```

학습된 최적 가중치는 `runs/train/yolo26-person/weights/best.pt`에 생성됩니다.

```bash
.venv/bin/python src/person_detector.py test.jpg \
  --model runs/train/yolo26-person/weights/best.pt
```

## 모델 선택

- `yolo26n.pt`: 가장 가볍고 빠르지만 작은 사람 탐지력이 낮을 수 있음.
- `yolo26s.pt`: 정확도와 속도의 균형.
- `yolo26m.pt`: 현재 기본값. 정확도 우선, 더 많은 메모리와 연산 필요.

Apple Silicon에서는 `--device mps`를 사용할 수 있습니다. 특정 연산에서 MPS 문제가 생기면
`--device cpu`로 실행하면 됩니다.

## 웹 카메라 테스트 페이지

서버를 실행합니다.

```bash
.venv/bin/python src/web_app.py
```

기본 설정은 `YOLO26m`, 960px 추론입니다. 필요하면 환경변수로 변경할 수 있습니다.

```bash
YOLO_MODEL=yolo26s.pt YOLO_IMGSZ=768 .venv/bin/python src/web_app.py
```

브라우저에서 [http://127.0.0.1:8765](http://127.0.0.1:8765)을 열고
`카메라 시작`을 누른 뒤 카메라 권한을 허용합니다. 프레임은 로컬 서버에서만 처리되며
저장되지 않습니다.

## Podman으로 실행

이미지를 빌드합니다.

```bash
cd programming_exam
podman build -t yolo26-person-api -f Containerfile .
```

컨테이너를 실행합니다.

```bash
podman run --rm -p 8765:8765 --name yolo26-person-api yolo26-person-api
```

모델/추론 크기를 바꿀 때:

```bash
podman run --rm -p 8765:8765 \
  -e YOLO_MODEL=yolo26s.pt \
  -e YOLO_IMGSZ=768 \
  --name yolo26-person-api \
  yolo26-person-api
```

웹 카메라는 혼잡도 측정을 위해 기본적으로 밀집 탐지 모드를 사용합니다. 1280px 프레임을
전체 화면과 네 개의 겹치는 타일로 분석한 뒤 중복 박스를 제거합니다. 일반 단일 프레임
탐지가 필요하면 바이너리 API에 `dense=false`를 전달합니다.

## JSON API

외부 앱에서는 `POST /api/v1/detect`에 Base64 이미지를 JSON으로 전달할 수 있습니다.
Swagger 문서는 [http://127.0.0.1:8765/docs](http://127.0.0.1:8765/docs)에서 확인합니다.

요청:

```json
{
  "image_base64": "/9j/4AAQSkZJRgABAQ...",
  "confidence": 0.25,
  "dense_mode": true,
  "request_id": "camera-frame-001"
}
```

응답:

```json
{
  "request_id": "camera-frame-001",
  "width": 1280,
  "height": 720,
  "count": 1,
  "boxes": [
    {
      "class_id": 0,
      "label": "person",
      "confidence": 0.91,
      "x1": 120.4,
      "y1": 88.2,
      "x2": 480.7,
      "y2": 690.1
    }
  ],
  "inference_ms": 142.5,
  "model": "yolo26m.pt",
  "inference_size": 960,
  "detection_mode": "dense_tiles",
  "inference_passes": 5,
  "device": "mps"
}
```

Python 호출 예제:

```python
import base64
import requests

with open("test.jpg", "rb") as image_file:
    image_base64 = base64.b64encode(image_file.read()).decode("ascii")

response = requests.post(
    "http://127.0.0.1:8765/api/v1/detect",
    json={
        "image_base64": image_base64,
        "confidence": 0.25,
        "dense_mode": True,
        "request_id": "test-001",
    },
    timeout=30,
)
response.raise_for_status()
print(response.json())
```
