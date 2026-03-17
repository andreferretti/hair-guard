import { PoseLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs";

const video = document.getElementById("webcam");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const warningEl = document.getElementById("warning");
const statusEl = document.getElementById("status");

const COOLDOWN_SECONDS = 3;
const WAIT_BEFORE_BEEP_SECONDS = 0.69;
const DISTANCE_THRESHOLD = 0.3;

let poseLandmarker = null;
let running = false;
let lastPlayTime = 0;
let triggerStartTime = 0;
let alertAudio = null;

async function init() {
  statusEl.textContent = "Loading pose model…";
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm"
  );
  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
      delegate: "GPU",
    },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.8,
    minTrackingConfidence: 0.8,
  });

  alertAudio = new Audio("alert.wav");

  statusEl.textContent = "Starting camera…";
  await startCamera();
}

function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function detect() {
  if (!running) return;

  // Match canvas to the video's actual displayed size
  const rect = video.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  canvas.style.width = rect.width + "px";
  canvas.style.height = rect.height + "px";
  canvas.style.left = (rect.left - video.parentElement.getBoundingClientRect().left) + "px";
  canvas.style.top = (rect.top - video.parentElement.getBoundingClientRect().top) + "px";

  const results = poseLandmarker.detectForVideo(video, performance.now());
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (results.landmarks && results.landmarks.length > 0) {
    const lm = results.landmarks[0];
    const w = canvas.width;
    const h = canvas.height;

    // Temples (ear proxies) — landmarks 7 & 8
    const leftTemple = lm[7];
    const rightTemple = lm[8];

    // Wrists — landmarks 15 & 16
    const leftWrist = lm[15];
    const rightWrist = lm[16];

    // Draw temple dots (red)
    for (const p of [leftTemple, rightTemple]) {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, 5, 0, Math.PI * 2);
      ctx.fillStyle = "red";
      ctx.fill();
    }

    // Distance checks
    const dLWLT = dist(leftWrist, leftTemple);
    const dLWRT = dist(leftWrist, rightTemple);
    const dLeft = Math.min(dLWLT, dLWRT);
    const leftClosest = dLWLT <= dLWRT ? leftTemple : rightTemple;

    ctx.beginPath();
    ctx.moveTo(leftWrist.x * w, leftWrist.y * h);
    ctx.lineTo(leftClosest.x * w, leftClosest.y * h);
    ctx.strokeStyle = dLeft < DISTANCE_THRESHOLD ? "red" : "blue";
    ctx.lineWidth = 2;
    ctx.stroke();

    const dRWLT = dist(rightWrist, leftTemple);
    const dRWRT = dist(rightWrist, rightTemple);
    const dRight = Math.min(dRWLT, dRWRT);
    const rightClosest = dRWLT <= dRWRT ? leftTemple : rightTemple;

    ctx.beginPath();
    ctx.moveTo(rightWrist.x * w, rightWrist.y * h);
    ctx.lineTo(rightClosest.x * w, rightClosest.y * h);
    ctx.strokeStyle = dRight < DISTANCE_THRESHOLD ? "red" : "blue";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw wrist dots (red when too close)
    ctx.beginPath();
    ctx.arc(leftWrist.x * w, leftWrist.y * h, 5, 0, Math.PI * 2);
    ctx.fillStyle = dLeft < DISTANCE_THRESHOLD ? "red" : "cyan";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(rightWrist.x * w, rightWrist.y * h, 5, 0, Math.PI * 2);
    ctx.fillStyle = dRight < DISTANCE_THRESHOLD ? "red" : "cyan";
    ctx.fill();

    const trigger = dLeft < DISTANCE_THRESHOLD || dRight < DISTANCE_THRESHOLD;
    const now = performance.now() / 1000;

    if (trigger) {
      warningEl.classList.remove("hidden");
      if (triggerStartTime === 0) {
        triggerStartTime = now;
      } else if (now - triggerStartTime >= WAIT_BEFORE_BEEP_SECONDS) {
        if (now - lastPlayTime > COOLDOWN_SECONDS) {
          alertAudio.currentTime = 0;
          alertAudio.play();
          if (Notification.permission === "granted") {
            new Notification("Stop touching your hair!", { body: "You can do it." });
          }
          lastPlayTime = now;
          triggerStartTime = 0;
        }
      }
    } else {
      warningEl.classList.add("hidden");
      triggerStartTime = 0;
    }
  } else {
    warningEl.classList.add("hidden");
    triggerStartTime = 0;
  }

  requestAnimationFrame(detect);
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true });
  video.srcObject = stream;
  await video.play();

  if (Notification.permission === "default") {
    Notification.requestPermission();
  }

  running = true;
  statusEl.textContent = "You'll hear a sound whenever your hand gets near your hair.";
  detect();
}

init();
