// All sound is synthesized with the Web Audio API — no external audio files,
// so there's nothing to license or host. AudioContext must be created/resumed
// from inside a real user-gesture handler (browser autoplay policy), so call
// unlock() synchronously at the top of the "Start Game" click handler.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.musicTimer = null;
    this.musicStep = 0;
  }

  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  setMuted(muted) {
    this.muted = muted;
    if (muted) this.stopMusic();
  }

  _tone(freq, startOffset, duration, type, peakGain) {
    if (this.muted || !this.ctx) return;
    const t0 = this.ctx.currentTime + startOffset;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peakGain, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  countdownBeep(isFinal) {
    this._tone(isFinal ? 880 : 523, 0, 0.15, "square", 0.12);
  }

  repHit(side) {
    this._tone(side === "left" ? 660 : 740, 0, 0.07, "square", 0.09);
  }

  roundComplete() {
    [523, 659, 784, 1046].forEach((freq, i) => this._tone(freq, i * 0.11, 0.25, "triangle", 0.13));
  }

  startMusic() {
    if (this.muted || this.musicTimer || !this.ctx) return;
    const bassLine = [220, 220, 277, 220, 330, 220, 277, 196];
    this.musicStep = 0;
    this.musicTimer = setInterval(() => {
      if (this.muted) return;
      const note = bassLine[this.musicStep % bassLine.length];
      this._tone(note, 0, 0.16, "triangle", 0.045);
      if (this.musicStep % 2 === 0) this._tone(note * 2, 0.05, 0.05, "square", 0.018);
      this.musicStep += 1;
    }, 220);
  }

  stopMusic() {
    if (this.musicTimer) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }
}
