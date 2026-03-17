import { PoseLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs";

const isMobile = /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  || (navigator.maxTouchPoints > 1 && !window.matchMedia("(pointer: fine)").matches);

const video = document.getElementById("webcam");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");
const warningEl = document.getElementById("warning");
const statusEl = document.getElementById("status");
const startScreen = document.getElementById("start-screen");
const startBtn = document.getElementById("start-btn");
const containerEl = document.getElementById("container");

if (isMobile) {
  startBtn.remove();
  const desc = document.getElementById("start-desc");
  desc.textContent = "Sorry, Hair Guard is designed for desktop only. It uses your webcam to detect when your hand gets close to your hair while you work at a desk — something that doesn't really apply on a phone or tablet. Open this page on your computer to get started.";
  throw new Error("mobile");
}

const COOLDOWN_SECONDS = 3;
const WAIT_BEFORE_BEEP_SECONDS = 0.69;
const DISTANCE_THRESHOLD = 0.3;

let poseLandmarker = null;
let running = false;
let lastPlayTime = 0;
let triggerStartTime = 0;
let alertAudio = null;

// Web Worker timer — not throttled in background tabs
const timerWorker = new Worker(
  URL.createObjectURL(new Blob([`
    let id = null;
    onmessage = (e) => {
      if (e.data === "start") {
        if (id) clearInterval(id);
        id = setInterval(() => postMessage("tick"), 200);
      } else if (e.data === "stop") {
        if (id) { clearInterval(id); id = null; }
      }
    };
  `], { type: "application/javascript" }))
);

timerWorker.onmessage = () => {
  if (running && document.hidden) detect();
};

function scheduleNextDetect() {
  if (!running) return;
  if (!document.hidden) {
    requestAnimationFrame(detect);
  }
  // When hidden, the worker interval drives detect()
}

document.addEventListener("visibilitychange", () => {
  if (!running) return;
  if (!document.hidden) {
    requestAnimationFrame(detect);
  }
});

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

  const hidden = document.hidden;

  if (!hidden) {
    // Match canvas to the video's actual displayed size
    const rect = video.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
    canvas.style.left = (rect.left - video.parentElement.getBoundingClientRect().left) + "px";
    canvas.style.top = (rect.top - video.parentElement.getBoundingClientRect().top) + "px";
  }

  const results = poseLandmarker.detectForVideo(video, performance.now());

  if (!hidden) ctx.clearRect(0, 0, canvas.width, canvas.height);

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

    if (!hidden) {
      // Draw temple dots (red)
      for (const p of [leftTemple, rightTemple]) {
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, 5, 0, Math.PI * 2);
        ctx.fillStyle = "red";
        ctx.fill();
      }
    }

    // Distance checks
    const dLWLT = dist(leftWrist, leftTemple);
    const dLWRT = dist(leftWrist, rightTemple);
    const dLeft = Math.min(dLWLT, dLWRT);
    const leftClosest = dLWLT <= dLWRT ? leftTemple : rightTemple;

    const dRWLT = dist(rightWrist, leftTemple);
    const dRWRT = dist(rightWrist, rightTemple);
    const dRight = Math.min(dRWLT, dRWRT);
    const rightClosest = dRWLT <= dRWRT ? leftTemple : rightTemple;

    const trigger = dLeft < DISTANCE_THRESHOLD || dRight < DISTANCE_THRESHOLD;
    const now = performance.now() / 1000;

    // Determine if we've been triggered long enough to alert
    let alerting = false;
    if (trigger) {
      if (triggerStartTime === 0) {
        triggerStartTime = now;
      } else if (now - triggerStartTime >= WAIT_BEFORE_BEEP_SECONDS) {
        alerting = true;
        if (now - lastPlayTime > COOLDOWN_SECONDS) {
          alertAudio.currentTime = 0;
          alertAudio.play();
          lastPlayTime = now;
          triggerStartTime = 0;
        }
      }
      warningEl.classList.remove("hidden");
    } else {
      warningEl.classList.add("hidden");
      triggerStartTime = 0;
    }

    if (!hidden) {
      // Draw lines (red only when alerting)
      const leftAlarm = alerting && dLeft < DISTANCE_THRESHOLD;
      const rightAlarm = alerting && dRight < DISTANCE_THRESHOLD;

      ctx.beginPath();
      ctx.moveTo(leftWrist.x * w, leftWrist.y * h);
      ctx.lineTo(leftClosest.x * w, leftClosest.y * h);
      ctx.strokeStyle = leftAlarm ? "red" : "blue";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(rightWrist.x * w, rightWrist.y * h);
      ctx.lineTo(rightClosest.x * w, rightClosest.y * h);
      ctx.strokeStyle = rightAlarm ? "red" : "blue";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw wrist dots (red only when alerting)
      ctx.beginPath();
      ctx.arc(leftWrist.x * w, leftWrist.y * h, 5, 0, Math.PI * 2);
      ctx.fillStyle = leftAlarm ? "red" : "cyan";
      ctx.fill();

      ctx.beginPath();
      ctx.arc(rightWrist.x * w, rightWrist.y * h, 5, 0, Math.PI * 2);
      ctx.fillStyle = rightAlarm ? "red" : "cyan";
      ctx.fill();
    }
  } else {
    warningEl.classList.add("hidden");
    triggerStartTime = 0;
  }

  scheduleNextDetect();
}

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
    await video.play();
  } catch (err) {
    startScreen.classList.remove("hidden");
    containerEl.classList.add("hidden");
    statusEl.classList.add("hidden");
    const desc = document.getElementById("start-desc");
    desc.style.color = "#e55";
    desc.textContent = "Camera access is required for this tool to work. Please allow camera access in your browser settings and reload the page.";
    startBtn.remove();
    return;
  }

  running = true;
  timerWorker.postMessage("start");
  statusEl.textContent = "You'll hear a sound whenever your hand gets near your hair.";
  scheduleNextDetect();
}

async function launch() {
  startScreen.classList.add("hidden");
  containerEl.classList.remove("hidden");
  statusEl.classList.remove("hidden");
  await init();
}

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  await launch();
});

// Auto-start if camera permission was already granted
try {
  const perm = await navigator.permissions.query({ name: "camera" });
  if (perm.state === "granted") {
    launch();
  }
} catch (e) {
  // Permissions API not supported — show start button as fallback
}
