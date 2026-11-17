class SoundEngine {
  private ctx: AudioContext | null = null;
  private lastLandAt = 0;
  muted = false;

  private ensureCtx(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private tone(
    freq: number,
    endFreq: number,
    duration: number,
    type: OscillatorType,
    gainVal: number,
    delay = 0
  ): void {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    const jitter = 0.96 + Math.random() * 0.08;
    osc.frequency.setValueAtTime(freq * jitter, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq * jitter), now + duration);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(gainVal, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.01);
  }

  playJump(): void {
    this.tone(240, 520, 0.11, 'triangle', 0.075);
    this.tone(360, 680, 0.08, 'sine', 0.035, 0.01);
  }

  playLand(intensity = 0.5): void {
    const nowMs = performance.now();
    if (nowMs - this.lastLandAt < 70) return;
    this.lastLandAt = nowMs;
    const vol = Math.min(0.065, 0.02 + intensity * 0.045);
    this.tone(130, 58, 0.07, 'triangle', vol);
  }

  playBounce(): void {
    this.tone(210, 660, 0.17, 'sine', 0.085);
    this.tone(320, 880, 0.14, 'triangle', 0.04, 0.02);
  }

  playGrab(): void {
    this.tone(360, 520, 0.065, 'sine', 0.06);
    this.tone(640, 760, 0.05, 'triangle', 0.035, 0.02);
  }

  playThrow(): void {
    this.tone(420, 210, 0.09, 'triangle', 0.065);
  }

  playPlate(): void {
    this.tone(440, 660, 0.09, 'sine', 0.065);
    this.tone(880, 920, 0.07, 'triangle', 0.025, 0.02);
  }

  playSwitch(): void {
    this.tone(320, 680, 0.1, 'triangle', 0.055);
    this.tone(540, 720, 0.07, 'sine', 0.04, 0.025);
  }

  playDoorOpen(): void {
    this.tone(260, 440, 0.16, 'triangle', 0.065);
    this.tone(390, 587, 0.18, 'sine', 0.04, 0.04);
  }

  playDoorClose(): void {
    this.tone(340, 170, 0.13, 'triangle', 0.05);
  }

  playBlast(): void {
    this.tone(160, 46, 0.2, 'sawtooth', 0.065);
    this.tone(280, 90, 0.14, 'triangle', 0.055);
  }

  playRespawn(): void {
    this.tone(320, 110, 0.2, 'sawtooth', 0.05);
    this.tone(240, 520, 0.16, 'sine', 0.045, 0.1);
  }

  playSolved(): void {
    const notes = [440, 554.37, 659.25, 880, 1108.73];
    notes.forEach((n, idx) => {
      this.tone(n, n * 1.015, 0.24, 'triangle', 0.075, idx * 0.075);
      this.tone(n * 0.5, n * 0.5, 0.26, 'sine', 0.035, idx * 0.075);
    });
  }
}

export const soundFX = new SoundEngine();
