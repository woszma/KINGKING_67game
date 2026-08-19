import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// Per-hand landmark indices (21 points) used elsewhere in the app.
export const HAND_LM = {
  WRIST: 0,
  MIDDLE_MCP: 9, // wrist->this = a stable "palm length" reference for scale
};

export class HandTracker {
  constructor() {
    this.landmarker = null;
    this.lastVideoTime = -1;
  }

  async init() {
    const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
    this.landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 2,
    });
  }

  // Returns { left: landmarks21|null, right: landmarks21|null }, or null if no
  // new frame was available to run inference on yet.
  detect(videoEl) {
    if (!this.landmarker || videoEl.readyState < 2) return null;
    if (videoEl.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = videoEl.currentTime;

    const result = this.landmarker.detectForVideo(videoEl, performance.now());
    const hands = { left: null, right: null };
    result.landmarks?.forEach((lm, i) => {
      // MediaPipe's handedness classifier assumes the input frame is already
      // mirrored (selfie-style). We feed it the raw, unmirrored camera frame,
      // so its "Left"/"Right" output comes out backwards relative to the
      // subject's true anatomical hand — swap it here to correct for that.
      const label = result.handedness?.[i]?.[0]?.categoryName;
      if (label === "Left") hands.right = lm;
      else if (label === "Right") hands.left = lm;
    });
    return hands;
  }
}
