// Each part's pivot fraction (0..1 within its own image) was measured from the
// red (255,0,0) marker dot the artist placed in the source PNG — it marks the
// exact point that should be pinned to its skeleton joint and rotated around.
// `w`/`h` are the ORIGINAL PNG pixel dimensions (unchanged from the source
// file) — never hand-pick a display size per part, always scale every part by
// the same DISPLAY_SCALE below so proportions stay true to the artwork.
const NATURAL = {
  body: {
    src: "assets/penguin/body.png",
    w: 1027,
    h: 1184,
    pivot: { x: 0.5044, y: 0.1622 },
    // Where the artist marked the shoulder joints directly on the body art —
    // wings attach here so they stay glued to the drawing.
    leftShoulder: { x: 0.2283, y: 0.1271 },
    rightShoulder: { x: 0.7809, y: 0.1271 },
  },
  head: {
    src: "assets/penguin/head.png",
    w: 977,
    h: 750,
    pivot: { x: 0.5046, y: 0.9627 },
    // Where the artist marked each eye — the live camera-eye overlay is
    // centered here (see PenguinAvatar.updateEyes).
    leftEye: { x: 0.3055, y: 0.4907 },
    rightEye: { x: 0.6668, y: 0.4907 },
  },
  leftWing: { src: "assets/penguin/left-wing.png", w: 495, h: 439, pivot: { x: 0.9573, y: 0.0455 } },
  rightWing: { src: "assets/penguin/right-wing.png", w: 495, h: 439, pivot: { x: 0.0398, y: 0.0455 } },
};

// One multiplier applied to every part's true pixel size (body ends up ~150px
// wide). To resize the whole character, change only this number — never
// resize a single part on its own, or proportions drift from the art.
const DISPLAY_SCALE = 150 / NATURAL.body.w;

// The character's position and size are fixed — it never slides or zooms
// with the camera. Only two things react to tracking, and both come from the
// rep counter's stable idle/raised state (not raw, jittery hand position):
// wing flap angle, and a small head tilt toward whichever hand is raised.
const WING_FLAP_DEG = 30;
const HEAD_REACT_DEG = 8;
const EYE_DIAMETER_FRAC = 0.64; // fraction of head display width

function wingAngleForState(side, state) {
  const upAngle = side === "left" ? WING_FLAP_DEG : -WING_FLAP_DEG;
  return state === "raised" ? upAngle : -upAngle;
}

function headTiltForState(leftState, rightState) {
  if (leftState === "raised" && rightState !== "raised") return -HEAD_REACT_DEG;
  if (rightState === "raised" && leftState !== "raised") return HEAD_REACT_DEG;
  return 0;
}

// Body is only ever translated (never scaled/rotated live), so a point marked
// at fraction `frac` on the body art offsets from the neck anchor with plain
// lerp math, expressed as a stage-size-independent px offset (works via CSS
// calc() even before the stage has ever been laid out).
function bodyPointOffset(frac) {
  const bodyW = NATURAL.body.w * DISPLAY_SCALE;
  const bodyH = NATURAL.body.h * DISPLAY_SCALE;
  return {
    dx: (frac.x - NATURAL.body.pivot.x) * bodyW,
    dy: (frac.y - NATURAL.body.pivot.y) * bodyH,
  };
}

export class PenguinAvatar {
  constructor(els) {
    // { body, leftWing, rightWing, headGroup, head, leftEyeCanvas, rightEyeCanvas }
    this.els = els;
    this.els.body.src = NATURAL.body.src;
    this.els.leftWing.src = NATURAL.leftWing.src;
    this.els.rightWing.src = NATURAL.rightWing.src;
    this.els.head.src = NATURAL.head.src;

    const headW = NATURAL.head.w * DISPLAY_SCALE;
    const eyeSize = headW * EYE_DIAMETER_FRAC;
    for (const [canvas, frac] of [
      [this.els.leftEyeCanvas, NATURAL.head.leftEye],
      [this.els.rightEyeCanvas, NATURAL.head.rightEye],
    ]) {
      canvas.style.width = `${eyeSize}px`;
      canvas.style.height = `${eyeSize}px`;
      canvas.style.left = `${frac.x * 100}%`;
      canvas.style.top = `${frac.y * 100}%`;
    }

    this.restPose();
  }

  restPose() {
    this._layout({ left: "idle", right: "idle" });
  }

  // repState: { left: "idle"|"raised", right: "idle"|"raised" } from RepCounter.
  update(repState) {
    this._layout(repState);
  }

  // Crops the player's real eyes out of the live video, die-cut to their
  // actual eyelid contour, and paints them into the two eye-socket canvases —
  // IG-filter style. `rightEye`/`leftEye` are { bbox, ring } in normalized
  // video space (see faceTracker.js eyeBBox / *_EYE_RING) — subject-relative,
  // same convention as elsewhere in this app. Mirroring the canvas draw (not
  // the points) keeps position AND eye-shape orientation consistent, like a
  // real mirror.
  updateEyes(video, rightEye, leftEye) {
    this._drawEye(this.els.rightEyeCanvas, video, rightEye);
    this._drawEye(this.els.leftEyeCanvas, video, leftEye);
  }

  _drawEye(canvas, video, eye) {
    if (!eye?.bbox || !video.videoWidth) return;
    const { bbox, ring } = eye;
    const ctx = canvas.getContext("2d");
    const size = canvas.width;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cx = ((bbox.minX + bbox.maxX) / 2) * vw;
    const cy = ((bbox.minY + bbox.maxY) / 2) * vh;
    const boxW = (bbox.maxX - bbox.minX) * vw;
    const boxH = (bbox.maxY - bbox.minY) * vh;
    const cropSize = Math.max(boxW, boxH, 1) * 2.2;
    const sx = cx - cropSize / 2;
    const sy = cy - cropSize / 2;
    const toDest = (lm) => ({
      x: ((lm.x * vw - sx) / cropSize) * size,
      y: ((lm.y * vh - sy) / cropSize) * size,
    });

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(size, 0);
    ctx.scale(-1, 1);

    if (ring && ring.length > 2) {
      ctx.beginPath();
      ring.forEach((lm, i) => {
        const p = toDest(lm);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.clip();
    }

    ctx.drawImage(video, sx, sy, cropSize, cropSize, 0, 0, size, size);
    ctx.restore();
  }

  _layout(repState) {
    const neckLeft = "50%";
    const neckTop = "38%";
    this._place(this.els.body, neckLeft, neckTop, NATURAL.body, 0);
    this._place(this.els.headGroup, neckLeft, neckTop, NATURAL.head, headTiltForState(repState.left, repState.right));

    const ls = bodyPointOffset(NATURAL.body.leftShoulder);
    const rs = bodyPointOffset(NATURAL.body.rightShoulder);
    this._place(this.els.leftWing, `calc(${neckLeft} + ${ls.dx}px)`, `calc(${neckTop} + ${ls.dy}px)`, NATURAL.leftWing, wingAngleForState("left", repState.left));
    this._place(this.els.rightWing, `calc(${neckLeft} + ${rs.dx}px)`, `calc(${neckTop} + ${rs.dy}px)`, NATURAL.rightWing, wingAngleForState("right", repState.right));
  }

  _place(el, leftExpr, topExpr, natural, rotateDeg) {
    el.style.left = leftExpr;
    el.style.top = topExpr;
    el.style.width = `${natural.w * DISPLAY_SCALE}px`;
    el.style.height = `${natural.h * DISPLAY_SCALE}px`;
    const originX = natural.pivot.x * 100;
    const originY = natural.pivot.y * 100;
    el.style.transformOrigin = `${originX}% ${originY}%`;
    el.style.transform = `translate(${-originX}%, ${-originY}%) rotate(${rotateDeg}deg)`;
  }
}
