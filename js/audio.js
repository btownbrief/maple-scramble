// Quiet, procedural sound for Maple Scramble. Sound defaults off and the
// AudioContext is created only after the player opts in and makes a gesture.
const SOUND_KEY = 'ms-sound-on';

class SoundEngine {
  constructor() {
    try {
      this.enabled = localStorage.getItem(SOUND_KEY) === '1';
    } catch {
      this.enabled = false;
    }
    this.ctx = null;
    this.master = null;
    this.voices = new Set();
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    try { localStorage.setItem(SOUND_KEY, enabled ? '1' : '0'); } catch { /* optional */ }
    if (this.master && this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.setValueAtTime(enabled ? 0.18 : 0.0001, this.ctx.currentTime);
    }
  }

  context() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      try {
        this.ctx = new AudioCtx();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.18;
        this.master.connect(this.ctx.destination);
      } catch {
        this.ctx = null;
        this.master = null;
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  tone(freq, delay, duration, volume, type = 'sine', endFreq = freq) {
    const ctx = this.context();
    if (!ctx || this.voices.size >= 10) return;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(this.master);
    this.voices.add(osc);
    osc.onended = () => {
      this.voices.delete(osc);
      osc.disconnect();
      gain.disconnect();
    };
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  pickup() {
    this.tone(190, 0, 0.055, 0.035, 'sine', 230);
  }

  snap() {
    this.tone(320, 0, 0.085, 0.065, 'triangle', 470);
  }

  reject() {
    this.tone(185, 0, 0.08, 0.032, 'sine', 145);
  }

  valid() {
    this.tone(520, 0, 0.11, 0.045);
    this.tone(660, 0.075, 0.13, 0.04);
  }

  win() {
    [392, 523, 659, 784].forEach((freq, i) => {
      this.tone(freq, i * 0.09, 0.24, 0.06, 'triangle');
    });
  }
}

export const sound = new SoundEngine();
