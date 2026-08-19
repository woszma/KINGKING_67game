// Vector/slope-primary rep detection: a rep is counted when the wrist's
// (smoothed) vertical velocity reverses direction — it was clearly moving up,
// then clearly moving down — rather than crossing a fixed position line. This
// judges the *shape* of the motion instead of an absolute height, so it
// naturally adapts to however high the player actually raises their hand.
//
// Differentiating position into velocity amplifies per-frame tracking jitter,
// so the velocity signal itself is smoothed fairly strongly (VEL_SMOOTH_ALPHA)
// — trading a little latency for a much cleaner signal to threshold against.
const VEL_SMOOTH_ALPHA = 0.55;

// Velocity thresholds scale with the detected hand size (closer to camera =
// bigger apparent motion for the same real movement) — same normalization
// idea as the position-margin approach this replaces.
const RISE_FACTOR = 2.0; // must move up faster than handScale * this to start a "rise"
const FALL_FACTOR = 1.0; // then move down faster than handScale * this confirms the reversal -> counts
const MIN_VEL_THRESHOLD = 0.15; // floor so small/far-away hands still need *some* real motion

// If a "rise" never resolves into a confirmed reversal within this long (hand
// stalled, left frame, tracking lost), abandon it — don't count, and re-arm.
const RISE_TIMEOUT_SEC = 1.2;

export class RepCounter {
  constructor({ onRep = null } = {}) {
    this.onRep = onRep;
    this.reset();
  }

  reset() {
    this.state = { left: "idle", right: "idle" }; // idle | raised ("mid-rise, arming for the down-swing")
    this.counts = { left: 0, right: 0 };
    this.timestamps = [];
    this.total = 0;
    this.riseStartTime = { left: 0, right: 0 };
    this.lastY = { left: null, right: null };
    this.lastSampleTime = { left: null, right: null };
    this.velocity = { left: 0, right: 0 };
    this.thresholds = {
      left: { rise: 0, fall: 0 },
      right: { rise: 0, fall: 0 },
    };
  }

  // wristY: normalized [0,1], smaller = higher up.
  // handScale: normalized palm-length reference (bigger = closer to camera).
  update(side, wristY, handScale, nowSec) {
    const prevY = this.lastY[side] ?? wristY;
    const prevTime = this.lastSampleTime[side];
    const dt = prevTime !== null ? Math.max(nowSec - prevTime, 1 / 120) : 1 / 30;
    this.lastY[side] = wristY;
    this.lastSampleTime[side] = nowSec;

    // Negative velocity = moving up (y decreases upward).
    const rawVelocity = (wristY - prevY) / dt;
    this.velocity[side] = this.velocity[side] * VEL_SMOOTH_ALPHA + rawVelocity * (1 - VEL_SMOOTH_ALPHA);

    const riseThreshold = Math.max(MIN_VEL_THRESHOLD, handScale * RISE_FACTOR);
    const fallThreshold = Math.max(MIN_VEL_THRESHOLD * 0.6, handScale * FALL_FACTOR);
    this.thresholds[side] = { rise: riseThreshold, fall: fallThreshold };

    const vel = this.velocity[side];
    const current = this.state[side];

    if (current === "idle" && vel < -riseThreshold) {
      this.state[side] = "raised";
      this.riseStartTime[side] = nowSec;
    } else if (current === "raised") {
      if (vel > fallThreshold) {
        // Reversal confirmed: was clearly moving up, now clearly moving down.
        this.state[side] = "idle";
        this.counts[side] += 1;
        this.total += 1;
        this.timestamps.push(nowSec);
        this.onRep?.(side);
      } else if (nowSec - this.riseStartTime[side] > RISE_TIMEOUT_SEC) {
        this.state[side] = "idle"; // abandoned — stalled or lost tracking, don't count
      }
    }
  }

  // Call every frame for a side even when that hand wasn't detected, so a
  // hand that disappears mid-rise still gets released after the timeout.
  checkStuck(side, nowSec) {
    if (this.state[side] === "raised" && nowSec - this.riseStartTime[side] > RISE_TIMEOUT_SEC) {
      this.state[side] = "idle";
    }
  }

  peakRps() {
    let max = 0;
    for (let i = 0; i < this.timestamps.length; i++) {
      let count = 0;
      for (let j = i; j < this.timestamps.length; j++) {
        if (this.timestamps[j] - this.timestamps[i] <= 1) count++;
        else break;
      }
      if (count > max) max = count;
    }
    return max;
  }

  avgRps(elapsedSec) {
    return elapsedSec > 0 ? this.total / elapsedSec : 0;
  }
}
