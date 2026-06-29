const video = document.querySelector("#video");
const overlay = document.querySelector("#overlay");
const captureCanvas = document.querySelector("#captureCanvas");
const cameraButton = document.querySelector("#cameraButton");
const cameraButtonText = document.querySelector("#cameraButtonText");
const emptyState = document.querySelector("#emptyState");
const liveBadge = document.querySelector("#liveBadge");
const peopleCount = document.querySelector("#peopleCount");
const countValue = document.querySelector("#countValue");
const densityBadge = document.querySelector("#densityBadge");
const densityValue = document.querySelector("#densityValue");
const densityLevel = document.querySelector("#densityLevel");
const confidence = document.querySelector("#confidence");
const confidenceValue = document.querySelector("#confidenceValue");
const latency = document.querySelector("#latency");
const detectionStatus = document.querySelector("#detectionStatus");
const errorMessage = document.querySelector("#errorMessage");
const serverDot = document.querySelector("#serverDot");
const serverStatus = document.querySelector("#serverStatus");
const deviceName = document.querySelector("#deviceName");
const modelName = document.querySelector("#modelName");
const cameraModelName = document.querySelector("#cameraModelName");
const cameraModal = document.querySelector("#cameraModal");
const cameraTitle = document.querySelector("#cameraTitle");
const mapStage = document.querySelector("#mapStage");
const updateAge = document.querySelector("#updateAge");
const viewer = document.querySelector("#viewer");
const floorSvg = document.querySelector("#floorSvg");
const dynamicZones = document.querySelector("#dynamicZones");
const cameraMarkers = document.querySelector("#cameraMarkers");
const zoneRows = document.querySelector("#zoneRows");

const overlayContext = overlay.getContext("2d");
const captureContext = captureCanvas.getContext("2d");
let stream = null;
let detecting = false;
let timer = null;
let mapScale = 1;
let secondsSinceUpdate = 0;
let startingCamera = false;
let cameraStartToken = 0;
let activeSpaceId = 1;
let floorData = null;
const RUST_API_BASE = `${window.location.protocol}//${window.location.hostname}:8080`;
const SPACE_CAPACITY = 20;
const COMPACT_ZONE_LABELS = {
  7: "더브레인",
  8: "엑사하트",
  9: "포토 키오스크",
  10: "AR 스포츠",
};
const queryParams = new URLSearchParams(window.location.search);
const EMBED_CAMERA_MODE = queryParams.get("embed") === "camera";
const EMBED_SPACE_ID = Number.parseInt(queryParams.get("space") || "1", 10);
let lastLiveFrameUploadMs = 0;

confidence.addEventListener("input", () => {
  confidenceValue.value = `${confidence.value}%`;
});

cameraButton.addEventListener("click", () => {
  if (stream) stopCamera();
  else startCamera();
});

document.querySelectorAll("[data-close-camera]").forEach((button) => {
  button.addEventListener("click", closeCamera);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !cameraModal.classList.contains("hidden")) closeCamera();
});

cameraMarkers.addEventListener("click", (event) => {
  const marker = event.target.closest("[data-space-id]");
  if (!marker) return;
  openCamera(Number(marker.dataset.spaceId));
});
zoneRows.addEventListener("click", (event) => {
  const row = event.target.closest("[data-space-id]");
  if (!row) return;
  openCamera(Number(row.dataset.spaceId));
});
floorSvg.addEventListener("click", (event) => {
  const target = event.target.closest("[data-space-id]");
  if (!target) return;
  openCamera(Number(target.dataset.spaceId));
});

document.querySelector("#zoomIn").addEventListener("click", () => setMapScale(mapScale + 0.1));
document.querySelector("#zoomOut").addEventListener("click", () => setMapScale(mapScale - 0.1));
document.querySelector("#resetMap").addEventListener("click", () => setMapScale(1));

window.addEventListener("resize", resizeOverlay);
window.addEventListener("beforeunload", stopCamera);

setInterval(() => {
  secondsSinceUpdate += 1;
  updateAge.textContent = secondsSinceUpdate < 10 ? "방금" : `${secondsSinceUpdate}초 전`;
}, 1000);

async function checkServer() {
  try {
    const response = await fetch("/api/v1/health");
    if (!response.ok) throw new Error("Server not ready");
    const info = await response.json();
    serverDot.classList.add("ready");
    serverStatus.textContent = "실시간 운영 중";
    deviceName.textContent = info.device;
    const displayModel = info.model.replace(".pt", "");
    modelName.textContent = `${displayModel} · ${info.inference_size}px · ${info.device.toUpperCase()}`;
    cameraModelName.textContent = displayModel;
  } catch {
    serverStatus.textContent = "모델 연결 실패";
    serverDot.classList.remove("ready");
  }
}

function selectZone(zoneName) {
  document.querySelectorAll("[data-space-id]").forEach((zone) => {
    zone.classList.toggle("selected", Number(zone.dataset.spaceId) === zoneName);
  });
  document.querySelectorAll(".zone-row[data-space-id]").forEach((row) => {
    row.classList.toggle("active", Number(row.dataset.spaceId) === zoneName);
  });
  window.setTimeout(() => {
    document.querySelectorAll("[data-space-id]").forEach((item) => item.classList.remove("selected", "active"));
  }, 1600);
}

function setMapScale(nextScale) {
  mapScale = Math.max(0.8, Math.min(1.4, Number(nextScale.toFixed(1))));
  mapStage.style.transform = `scale(${mapScale})`;
}

function openCamera(spaceId) {
  activeSpaceId = spaceId;
  const space = floorData?.spaces?.find((item) => item.id === spaceId);
  cameraTitle.textContent = `${space?.title_ko || `공간 ${spaceId}`} 카메라`;
  selectZone(spaceId);
  cameraModal.classList.remove("hidden");
  document.body.classList.add("modal-open");
}

function closeCamera() {
  if (EMBED_CAMERA_MODE) return;
  stopCamera();
  cameraModal.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

async function startCamera() {
  if (startingCamera || stream) return;
  const startToken = ++cameraStartToken;
  startingCamera = true;
  cameraButton.disabled = true;
  hideError();
  if (!navigator.mediaDevices?.getUserMedia) {
    startingCamera = false;
    cameraButton.disabled = false;
    showError("이 브라우저는 카메라 접근을 지원하지 않습니다.");
    return;
  }

  try {
    detectionStatus.textContent = "카메라 연결";
    stream = await getCameraStream();
    if (startToken !== cameraStartToken) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await waitForVideoReady(video);
    try {
      await video.play();
    } catch (error) {
      // Ignore benign race when stop/reload interrupts play during rapid toggles.
      if (
        error?.name === "AbortError" ||
        String(error?.message || "").includes("interrupted by a new load request")
      ) {
        return;
      }
      throw error;
    }
    if (startToken !== cameraStartToken || !stream) return;
    resizeOverlay();
    emptyState.classList.add("hidden");
    liveBadge.classList.remove("hidden");
    peopleCount.classList.remove("hidden");
    cameraButton.classList.add("stop");
    cameraButtonText.textContent = "카메라 중지";
    detectionStatus.textContent = "탐지 중";
    scheduleDetection(80);
  } catch (error) {
    stream = null;
    detectionStatus.textContent = "권한 필요";
    const message = error.name === "NotAllowedError"
      ? "카메라 권한이 거부되었습니다. 주소창에서 권한을 허용해 주세요."
      : `카메라를 시작하지 못했습니다: ${error.message}`;
    showError(message);
  } finally {
    if (startToken === cameraStartToken) {
      startingCamera = false;
      cameraButton.disabled = false;
    }
  }
}

function stopCamera() {
  cameraStartToken += 1;
  startingCamera = false;
  clearTimeout(timer);
  timer = null;
  detecting = false;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  video.pause();
  video.srcObject = null;
  overlayContext.clearRect(0, 0, overlay.width, overlay.height);
  emptyState.classList.remove("hidden");
  liveBadge.classList.add("hidden");
  peopleCount.classList.add("hidden");
  densityBadge.classList.add("hidden");
  cameraButton.classList.remove("stop");
  cameraButtonText.textContent = "카메라 시작";
  detectionStatus.textContent = "대기";
  latency.textContent = "— ms";
  countValue.textContent = "0";
  // Ensure dashboard count is reset when camera capture stops.
  void syncCountToBackend(activeSpaceId, 0);
  void syncDetectionToBackend(activeSpaceId, { count: 0, boxes: [], inference_ms: null, density: null });
  const spaceParam = Number.isFinite(activeSpaceId) ? `?space=${encodeURIComponent(activeSpaceId)}` : "";
  void fetch(`/api/v1/live/clear${spaceParam}`, { method: "POST" }).catch(() => {});
}

async function getCameraStream() {
  const preferred = {
    video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  };
  try {
    return await navigator.mediaDevices.getUserMedia(preferred);
  } catch (error) {
    // Some desktops reject facingMode/size constraints; retry with a plain camera request.
    if (
      error?.name === "OverconstrainedError" ||
      error?.name === "NotFoundError" ||
      error?.name === "ConstraintNotSatisfiedError"
    ) {
      return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
    throw error;
  }
}

function waitForVideoReady(videoElement) {
  if (videoElement.readyState >= 1) return Promise.resolve();
  return new Promise((resolve) => {
    const onReady = () => {
      videoElement.removeEventListener("loadedmetadata", onReady);
      resolve();
    };
    videoElement.addEventListener("loadedmetadata", onReady, { once: true });
    // Safety net for browsers that already have metadata but do not emit event again.
    setTimeout(onReady, 400);
  });
}

function scheduleDetection(delay = 250) {
  clearTimeout(timer);
  timer = setTimeout(detectFrame, delay);
}

async function detectFrame() {
  if (!stream || detecting || video.readyState < 2) {
    if (stream) scheduleDetection();
    return;
  }

  detecting = true;
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  // Preserve small, distant people for the server's overlapping tile detector.
  const scale = Math.min(1, 1280 / sourceWidth);
  captureCanvas.width = Math.round(sourceWidth * scale);
  captureCanvas.height = Math.round(sourceHeight * scale);
  captureContext.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);

  try {
    const blob = await canvasToBlob(captureCanvas, "image/jpeg", 0.88);
    await pushLiveFrame(blob);
    const threshold = Number(confidence.value) / 100;
    const response = await fetch(`/api/detect?conf=${threshold}&dense=true`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: blob,
    });
    if (!response.ok) throw new Error((await response.json()).detail || "Detection failed");

    const result = await response.json();
    drawDetections(result);
    countValue.textContent = result.count;
    await syncCountToBackend(activeSpaceId, result.count);
    await syncDetectionToBackend(activeSpaceId, result);
    updateDensityBadge(result.density);
    latency.textContent = `${Math.round(result.inference_ms)} ms`;
    detectionStatus.textContent = densityStatus(result.density);
    hideError();
  } catch (error) {
    detectionStatus.textContent = "오류";
    showError(`프레임 분석에 실패했습니다: ${error.message}`);
  } finally {
    detecting = false;
    if (stream) scheduleDetection();
  }
}

async function pushLiveFrame(blob) {
  const now = Date.now();
  if (now - lastLiveFrameUploadMs < 120) return;
  lastLiveFrameUploadMs = now;
  try {
    const spaceParam = Number.isFinite(activeSpaceId) ? `?space=${encodeURIComponent(activeSpaceId)}` : "";
    await fetch(`/api/v1/live/frame${spaceParam}`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg" },
      body: blob,
    });
  } catch {
    // Ignore intermittent relay failures; detection should keep running.
  }
}

async function syncCountToBackend(spaceId, count) {
  if (!Number.isFinite(spaceId)) return;
  try {
    await fetch(`${RUST_API_BASE}/api/v1/spaces/${spaceId}/count`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ count }),
    });
    secondsSinceUpdate = 0;
  } catch {
    // Keep local detection active even when backend sync momentarily fails.
  }
}

async function syncDetectionToBackend(spaceId, result) {
  if (!Number.isFinite(spaceId)) return;
  const confidences = result?.boxes?.map((box) => box.confidence) ?? [];
  const bestConfidence = confidences.length ? Math.max(...confidences) : null;
  try {
    await fetch(`${RUST_API_BASE}/api/v1/detections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        camera_id: `space-${spaceId}`,
        space_id: spaceId,
        people_count: result?.count ?? 0,
        confidence: bestConfidence,
        inference_ms: result?.inference_ms ?? null,
        density_score: result?.density?.score ?? null,
        density_level: result?.density?.level ?? null,
        source: "programming_exam",
      }),
    });
  } catch {
    // Keep local detection active even when backend sync momentarily fails.
  }
}

function drawDetections(result) {
  resizeOverlay();
  overlayContext.clearRect(0, 0, overlay.width, overlay.height);
  const containerRatio = overlay.width / overlay.height;
  const sourceRatio = result.width / result.height;
  let drawWidth;
  let drawHeight;
  let offsetX;
  let offsetY;

  if (sourceRatio > containerRatio) {
    drawWidth = overlay.width;
    drawHeight = overlay.width / sourceRatio;
    offsetX = 0;
    offsetY = (overlay.height - drawHeight) / 2;
  } else {
    drawHeight = overlay.height;
    drawWidth = overlay.height * sourceRatio;
    offsetX = (overlay.width - drawWidth) / 2;
    offsetY = 0;
  }

  const scaleX = drawWidth / result.width;
  const scaleY = drawHeight / result.height;
  drawDensityVectors(result, offsetX, offsetY, drawWidth, scaleX, scaleY, true);
  result.boxes.forEach((box, index) => {
    const x = offsetX + drawWidth - box.x2 * scaleX;
    const y = offsetY + box.y1 * scaleY;
    drawBox(x, y, (box.x2 - box.x1) * scaleX, (box.y2 - box.y1) * scaleY, box.confidence, index + 1);
  });
}

function densityStatus(density) {
  if (!density) return "탐지 중";
  const labels = densityLabels();
  return `탐지 중 · 밀집 ${labels[density.level] || density.level} ${Math.round(density.score)}%`;
}

function updateDensityBadge(density) {
  if (!density) {
    densityBadge.classList.add("hidden");
    return;
  }
  const labels = densityLabels();
  densityValue.textContent = `${Math.round(density.score)}%`;
  densityLevel.textContent = labels[density.level] || density.level;
  densityBadge.classList.remove("hidden");
}

function densityLabels() {
  return { empty: "없음", single: "단일", sparse: "낮음", normal: "보통", dense: "높음", crowded: "혼잡" };
}

function rustStatusFromCount(count) {
  if (count >= 16) return { key: "critical", label: "매우 혼잡" };
  if (count >= 11) return { key: "busy", label: "혼잡" };
  if (count >= 5) return { key: "normal", label: "보통" };
  return { key: "free", label: "여유" };
}

function rgbaFromHex(hex, alpha) {
  const value = hex.replace("#", "");
  if (value.length !== 6) return `rgba(66, 99, 143, ${alpha})`;
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function compactZoneTitle(space) {
  const compact = COMPACT_ZONE_LABELS[space.id];
  if (compact) return compact;
  const normalized = String(space.title_ko || "").replace(/\s+/g, " ").trim();
  return normalized.length > 8 ? `${normalized.slice(0, 8)}…` : normalized;
}

function renderFloorSnapshot(snapshot) {
  const countById = new Map(snapshot.counts.map((entry) => [entry.space_id, entry.count]));
  const colorByZone = new Map(snapshot.zones.map((zone) => [zone.id, zone.color]));

  dynamicZones.innerHTML = snapshot.spaces.map((space) => {
    const count = countById.get(space.id) ?? 0;
    const ratio = Math.min(100, Math.round((count / SPACE_CAPACITY) * 100));
    const color = colorByZone.get(space.zone) || "#42638f";
    const isCompact = space.width < 120;
    const title = isCompact ? `${space.id}. ${compactZoneTitle(space)}` : `${space.id}. ${space.title_ko}`;
    const titleClass = `zone-title${isCompact ? " zone-title--compact" : ""}`;
    const numberClass = `zone-number${isCompact ? " zone-number--compact" : ""}`;
    const numberText = isCompact ? `${count}명` : `${count}명 / ${ratio}%`;
    const titleY = isCompact ? space.y + 20 : space.y + 24;
    const numberY = isCompact ? space.y + 38 : space.y + 48;
    return `
      <g class="zone" data-space-id="${space.id}">
        <rect x="${space.x}" y="${space.y}" width="${space.width}" height="${space.height}" rx="8" fill="${rgbaFromHex(color, 0.22)}" stroke="${color}" stroke-width="2"></rect>
        <text class="${titleClass}" x="${space.x + space.width / 2}" y="${titleY}" text-anchor="middle">${title}</text>
        <text class="${numberClass}" x="${space.x + space.width / 2}" y="${numberY}" text-anchor="middle">${numberText}</text>
      </g>
    `;
  }).join("");

  cameraMarkers.innerHTML = snapshot.spaces.map((space) => {
    const centerX = ((space.x + (space.width / 2)) / snapshot.viewbox.width) * 100;
    const centerY = ((space.y + (space.height / 2)) / snapshot.viewbox.height) * 100;
    const compactClass = space.width < 120 ? " camera-marker--compact" : "";
    return `
      <button
        class="camera-marker${compactClass}"
        data-space-id="${space.id}"
        type="button"
        aria-label="${space.title_ko} 카메라 열기"
        style="left: calc(${centerX}% - 9px); top: calc(${centerY}% - 9px);"
      >●</button>
    `;
  }).join("");

  zoneRows.innerHTML = snapshot.spaces.map((space) => {
    const count = countById.get(space.id) ?? 0;
    const ratio = Math.min(100, Math.round((count / SPACE_CAPACITY) * 100));
    const status = rustStatusFromCount(count);
    return `
      <button class="zone-row" data-space-id="${space.id}" type="button">
        <span><i class="dot ${status.key}"></i>${space.title_ko}</span>
        <b>${count}명</b>
        <span class="rate"><b>${ratio}%</b><i><em style="width:${ratio}%"></em></i></span>
        <mark class="${status.key}">${status.label}</mark>
      </button>
    `;
  }).join("");
}

async function loadFloorSnapshot() {
  try {
    const response = await fetch(`${RUST_API_BASE}/api/v1/floor`);
    if (!response.ok) throw new Error("floor api failed");
    floorData = await response.json();
    renderFloorSnapshot(floorData);
    secondsSinceUpdate = 0;
  } catch {
    // Do not interrupt camera detection when Rust API is unavailable.
  }
}

function drawDensityVectors(result, offsetX, offsetY, drawWidth, scaleX, scaleY, mirrored) {
  const density = result?.density;
  if (!density?.pairs?.length || !density?.objects?.length) return;
  const objects = new Map(density.objects.map((object) => [object.index, object]));
  const drawablePairs = density.pairs
    .filter((pair) => pair.distance <= density.radius_px * 0.98)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, Math.min(6, density.objects.length));
  overlayContext.save();
  overlayContext.lineCap = "round";
  overlayContext.lineJoin = "round";
  drawablePairs.forEach((pair) => {
    const from = objects.get(pair.from_index);
    const to = objects.get(pair.to_index);
    if (!from || !to) return;
    const fromX = mirrored ? offsetX + drawWidth - from.center_x * scaleX : offsetX + from.center_x * scaleX;
    const toX = mirrored ? offsetX + drawWidth - to.center_x * scaleX : offsetX + to.center_x * scaleX;
    const fromY = offsetY + from.center_y * scaleY;
    const toY = offsetY + to.center_y * scaleY;
    const strength = Math.max(0.55, 1 - pair.distance / density.radius_px);
    overlayContext.lineWidth = 4 + strength * 5;
    overlayContext.strokeStyle = `rgba(255, 184, 48, ${Math.min(0.95, strength)})`;
    overlayContext.shadowColor = "rgba(255, 184, 48, .7)";
    overlayContext.shadowBlur = 16;
    overlayContext.beginPath();
    overlayContext.moveTo(fromX, fromY);
    overlayContext.lineTo(toX, toY);
    overlayContext.stroke();
  });
  density.objects.forEach((object) => {
    const x = mirrored ? offsetX + drawWidth - object.center_x * scaleX : offsetX + object.center_x * scaleX;
    const y = offsetY + object.center_y * scaleY;
    overlayContext.shadowBlur = 0;
    overlayContext.fillStyle = "rgba(5, 9, 16, .82)";
    overlayContext.beginPath();
    overlayContext.arc(x, y, 8, 0, Math.PI * 2);
    overlayContext.fill();
    overlayContext.fillStyle = "rgba(255, 191, 88, .95)";
    overlayContext.beginPath();
    overlayContext.arc(x, y, 5.5, 0, Math.PI * 2);
    overlayContext.fill();
  });
  overlayContext.restore();
}

function drawBox(x, y, width, height, score, index) {
  const color = "#2a83ff";
  const corner = Math.min(24, width * 0.18, height * 0.18);
  overlayContext.strokeStyle = color;
  overlayContext.lineWidth = 3;
  overlayContext.beginPath();
  overlayContext.moveTo(x, y + corner); overlayContext.lineTo(x, y); overlayContext.lineTo(x + corner, y);
  overlayContext.moveTo(x + width - corner, y); overlayContext.lineTo(x + width, y); overlayContext.lineTo(x + width, y + corner);
  overlayContext.moveTo(x + width, y + height - corner); overlayContext.lineTo(x + width, y + height); overlayContext.lineTo(x + width - corner, y + height);
  overlayContext.moveTo(x + corner, y + height); overlayContext.lineTo(x, y + height); overlayContext.lineTo(x, y + height - corner);
  overlayContext.stroke();
  const label = `PERSON ${index}  ${Math.round(score * 100)}%`;
  overlayContext.font = "600 12px sans-serif";
  const labelWidth = overlayContext.measureText(label).width + 16;
  const labelY = Math.max(0, y - 27);
  overlayContext.fillStyle = color;
  overlayContext.fillRect(x, labelY, labelWidth, 24);
  overlayContext.fillStyle = "#fff";
  overlayContext.fillText(label, x + 8, labelY + 16);
}

function resizeOverlay() {
  const rect = overlay.getBoundingClientRect();
  overlay.width = Math.round(rect.width);
  overlay.height = Math.round(rect.height);
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Frame encoding failed")), type, quality);
  });
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.remove("hidden");
  if (EMBED_CAMERA_MODE && !stream) {
    emptyState.classList.remove("hidden");
    emptyState.querySelector("h3").textContent = "클릭해서 카메라를 시작하세요";
    emptyState.querySelector("p").textContent = "브라우저 권한 허용 후 다시 클릭하면 연결됩니다.";
    emptyState.style.cursor = "pointer";
  }
}

function hideError() {
  errorMessage.classList.add("hidden");
}

checkServer();
if (EMBED_CAMERA_MODE) {
  document.body.classList.add("embed-camera");
  // Force camera-only layout even if CSS is stale in browser cache.
  const modalBackdrop = document.querySelector(".modal-backdrop");
  const cameraHeader = document.querySelector(".camera-header");
  const cameraControls = document.querySelector(".camera-controls");
  const cameraDialog = document.querySelector(".camera-dialog");
  const cameraLayout = document.querySelector(".camera-layout");
  if (modalBackdrop) modalBackdrop.style.display = "none";
  if (cameraHeader) cameraHeader.style.display = "none";
  if (cameraControls) cameraControls.style.display = "none";
  if (cameraDialog) {
    cameraDialog.style.width = "100vw";
    cameraDialog.style.maxWidth = "none";
    cameraDialog.style.height = "100vh";
    cameraDialog.style.maxHeight = "none";
    cameraDialog.style.borderRadius = "0";
  }
  if (cameraLayout) cameraLayout.style.gridTemplateColumns = "1fr";
  if (viewer) viewer.style.minHeight = "100vh";

  emptyState.addEventListener("click", () => {
    void startCamera();
  });
  viewer.addEventListener("click", () => {
    if (!stream) void startCamera();
  });
  openCamera(Number.isFinite(EMBED_SPACE_ID) && EMBED_SPACE_ID > 0 ? EMBED_SPACE_ID : 1);
  void startCamera();
} else {
  loadFloorSnapshot();
  setInterval(loadFloorSnapshot, 3000);
}
