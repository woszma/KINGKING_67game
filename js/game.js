import { startCamera, stopCamera } from "./camera.js";
import { HandTracker, HAND_LM } from "./handTracker.js";
import { FaceTracker, RIGHT_EYE_IDX, LEFT_EYE_IDX, RIGHT_EYE_RING, LEFT_EYE_RING, eyeBBox } from "./faceTracker.js";
import { PenguinAvatar } from "./avatar.js";
import { RepCounter } from "./repCounter.js";
import { AudioEngine } from "./audio.js";

const ROUND_SECONDS = 20;

// Simplified MediaPipe hand connections (skips a couple of palm cross-links)
// — enough to read as a hand skeleton in the small debug preview.
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

const BEST_KEY = "sixtyseven_best_total";

function messageForScore(total) {
  if (total < 10) return "Nice warm-up. Try again with more rhythm.";
  if (total < 20) return "Getting into rhythm!";
  if (total < 35) return "Solid speed!";
  if (total < 50) return "Blazing fast!";
  return "Insane! Are you even human?";
}

export class Game {
  constructor(dom) {
    this.dom = dom;
    this.handTracker = new HandTracker();
    this.faceTracker = new FaceTracker();
    this.avatar = new PenguinAvatar({
      body: dom.partBody,
      leftWing: dom.partLeftWing,
      rightWing: dom.partRightWing,
      headGroup: dom.headGroup,
      head: dom.partHead,
      leftEyeCanvas: dom.leftEyeCanvas,
      rightEyeCanvas: dom.rightEyeCanvas,
    });
    this.audio = new AudioEngine();
    this.counter = new RepCounter({ onRep: (side) => this.audio.repHit(side) });
    this.stream = null;
    this.rafId = null;
    this.debugVisible = true;
    this.roundState = "idle"; // idle | countdown | playing | done
    this.roundStartTime = 0;
    this.lastHands = { left: null, right: null };
    this.lastFace = null;
  }

  async ensureCamera() {
    if (this.stream) return;
    this.stream = await startCamera(this.dom.camVideo);
  }

  // Two models running side by side (hands for counting, face for the eye
  // overlay) — more CPU/GPU work per frame than a single model, worth keeping
  // in mind if this feels heavy on lower-end phones.
  async ensureTracker() {
    const tasks = [];
    if (!this.handTracker.landmarker) tasks.push(this.handTracker.init());
    if (!this.faceTracker.landmarker) tasks.push(this.faceTracker.init());
    await Promise.all(tasks);
  }

  stopLoop() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  stopEverything() {
    this.stopLoop();
    stopCamera(this.stream);
    this.stream = null;
  }

  async startRound() {
    this.counter.reset();
    this.roundState = "countdown";
    this._loop();
    await this._countdown();
    this.roundState = "playing";
    this.roundStartTime = performance.now();
    this._updateHud(ROUND_SECONDS, 0, 0, 0);
    this.audio.startMusic();
  }

  async _countdown() {
    for (const label of ["3", "2", "1"]) {
      this.dom.countdown.textContent = label;
      this.audio.countdownBeep(label === "1");
      await new Promise((r) => setTimeout(r, 700));
    }
    this.dom.countdown.textContent = "";
  }

  _loop() {
    const step = () => {
      this.rafId = requestAnimationFrame(step);
      const hands = this.handTracker.detect(this.dom.camVideo);
      if (hands) this.lastHands = hands;
      const face = this.faceTracker.detect(this.dom.camVideo);
      if (face) this.lastFace = face;

      const nowSec = performance.now() / 1000;
      if (this.roundState === "playing") this._trackReps(this.lastHands, nowSec);
      this.avatar.update(this.counter.state);
      if (this.lastFace) {
        const ringPoints = (indices) => indices.map((i) => this.lastFace[i]);
        this.avatar.updateEyes(
          this.dom.camVideo,
          { bbox: eyeBBox(this.lastFace, RIGHT_EYE_IDX), ring: ringPoints(RIGHT_EYE_RING) },
          { bbox: eyeBBox(this.lastFace, LEFT_EYE_IDX), ring: ringPoints(LEFT_EYE_RING) }
        );
      }
      this._drawDebug(this.lastHands);

      // Timer/HUD must keep advancing even while no hand is detected yet
      // (e.g. user still stepping into frame) — never gate this on tracking.
      if (this.roundState === "playing") {
        const elapsed = (performance.now() - this.roundStartTime) / 1000;
        const remaining = Math.max(0, ROUND_SECONDS - elapsed);
        this._updateHud(remaining, this.counter.total, this.counter.counts.left, this.counter.counts.right);
        if (remaining <= 0) this._finishRound();
      }
    };
    this.rafId = requestAnimationFrame(step);
  }

  _trackReps(hands, nowSec) {
    for (const side of ["left", "right"]) {
      const hand = hands[side];
      if (hand) {
        const handScale = Math.hypot(
          hand[HAND_LM.MIDDLE_MCP].x - hand[HAND_LM.WRIST].x,
          hand[HAND_LM.MIDDLE_MCP].y - hand[HAND_LM.WRIST].y
        );
        this.counter.update(side, hand[HAND_LM.WRIST].y, handScale, nowSec);
      } else {
        this.counter.checkStuck(side, nowSec);
      }
    }
  }

  _updateHud(remaining, total, left, right) {
    this.dom.hudTimer.textContent = remaining.toFixed(1);
    this.dom.hudTotal.textContent = String(total);
    this.dom.lrLeft.textContent = String(left);
    this.dom.lrRight.textContent = String(right);
  }

  _finishRound() {
    this.roundState = "done";
    this.stopLoop();
    this.audio.stopMusic();
    this.audio.roundComplete();
    const total = this.counter.total;
    const peak = this.counter.peakRps();
    const avg = this.counter.avgRps(ROUND_SECONDS);
    const best = Math.max(total, Number(localStorage.getItem(BEST_KEY) || 0));
    localStorage.setItem(BEST_KEY, String(best));

    this.dom.resultTotal.textContent = String(total);
    this.dom.statPeak.textContent = peak.toFixed(1);
    this.dom.statAvg.textContent = avg.toFixed(1);
    this.dom.statBest.textContent = String(best);
    this.dom.resultMessage.textContent = messageForScore(total);

    this.onRoundComplete?.();
  }

  quit() {
    this.roundState = "idle";
    this.audio.stopMusic();
    this.stopEverything();
  }

  toggleMute() {
    this.audio.setMuted(!this.audio.muted);
    return this.audio.muted;
  }

  toggleDebug() {
    this.debugVisible = !this.debugVisible;
    this.dom.debugPanel.classList.toggle("hidden", !this.debugVisible);
  }

  _drawDebug(hands) {
    if (!this.debugVisible) return;
    const canvas = this.dom.debugCanvas;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const video = this.dom.camVideo;

    // Draw the video "cover"-fit (crop to fill, preserve aspect ratio) instead
    // of stretching it into the fixed canvas box.
    const vw = video.videoWidth || w;
    const vh = video.videoHeight || h;
    const coverScale = Math.max(w / vw, h / vh);
    const dw = vw * coverScale;
    const dh = vh * coverScale;
    const dx = (w - dw) / 2;
    const dy = (h - dh) / 2;

    ctx.save();
    ctx.clearRect(0, 0, w, h);
    if (video.readyState >= 2 && video.videoWidth) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, dx, dy, dw, dh);
    }
    ctx.restore();

    const px = (lm) => ({ x: w - dx - lm.x * dw, y: dy + lm.y * dh });
    const drawHand = (landmarks, color) => {
      if (!landmarks) return;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.5;
      HAND_CONNECTIONS.forEach(([a, b]) => {
        const pa = px(landmarks[a]);
        const pb = px(landmarks[b]);
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      });
      landmarks.forEach((lm) => {
        const p = px(lm);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fill();
      });
    };
    drawHand(hands.left, "#e63946");
    drawHand(hands.right, "#2a6fdb");

    if (!hands.left && !hands.right) {
      this.dom.debugText.textContent = "no hand detected";
      return;
    }

    const fmt = (v) => (v ?? 0).toFixed(2);
    const lt = this.counter.thresholds.left;
    this.dom.debugText.textContent =
      `L wrist.y=${hands.left ? fmt(hands.left[HAND_LM.WRIST].y) : "-"} vel=${fmt(this.counter.velocity.left)} [${this.counter.state.left}]\n` +
      `R wrist.y=${hands.right ? fmt(hands.right[HAND_LM.WRIST].y) : "-"} vel=${fmt(this.counter.velocity.right)} [${this.counter.state.right}]\n` +
      `L thresholds rise=${lt.rise.toFixed(2)} fall=${lt.fall.toFixed(2)}`;
  }
}
