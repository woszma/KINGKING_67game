import {
  FaceLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const WASM_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// Canonical Face Mesh eye-corner/lid indices — enough for a tight eye bounding
// box. Labels are subject-relative (computed on the raw, unmirrored frame),
// same convention as Pose/Hand handedness elsewhere in this app.
export const RIGHT_EYE_IDX = [33, 133, 159, 145];
export const LEFT_EYE_IDX = [362, 263, 386, 374];

// Full eyelid contour loops (16 points each, in order around the eye) — used
// to clip the live eye crop to the player's actual eye shape ("die-cut")
// instead of a plain circle. Standard MediaPipe Face Mesh eye-contour index
// sets (FACEMESH_RIGHT_EYE / FACEMESH_LEFT_EYE), same subject-relative
// convention as above.
export const RIGHT_EYE_RING = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
export const LEFT_EYE_RING = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398];

export class FaceTracker {
  constructor() {
    this.landmarker = null;
    this.lastVideoTime = -1;
  }

  async init() {
    const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
    this.landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });
  }

  // Returns the raw 478-point landmark array for the first detected face, or
  // null if no new frame / no face.
  detect(videoEl) {
    if (!this.landmarker || videoEl.readyState < 2) return null;
    if (videoEl.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = videoEl.currentTime;

    const result = this.landmarker.detectForVideo(videoEl, performance.now());
    if (!result.faceLandmarks || result.faceLandmarks.length === 0) return null;
    return result.faceLandmarks[0];
  }
}

export function eyeBBox(landmarks, indices) {
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const i of indices) {
    const p = landmarks[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}
