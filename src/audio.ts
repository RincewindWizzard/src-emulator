import type { Radio, Sound } from './radio';

/** Töne (Tastenton, Alarm, DSC) und Rauschen/Signal über WebAudio */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private noiseGain!: GainNode;
  private sigGain!: GainNode;

  /** Muss aus einer Benutzeraktion heraus aufgerufen werden */
  unlock(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass'; filt.frequency.value = 2200; filt.Q.value = 0.4;
    this.noiseGain = ctx.createGain(); this.noiseGain.gain.value = 0;
    src.connect(filt).connect(this.noiseGain).connect(ctx.destination);
    src.start();
    // Signal: moduliertes "Funk"-Rauschen
    const osc = ctx.createOscillator(); osc.frequency.value = 420; osc.type = 'sawtooth';
    const lfo = ctx.createOscillator(); lfo.frequency.value = 4;
    const lfoG = ctx.createGain(); lfoG.gain.value = 90;
    lfo.connect(lfoG).connect(osc.frequency);
    this.sigGain = ctx.createGain(); this.sigGain.gain.value = 0;
    osc.connect(this.sigGain).connect(ctx.destination);
    osc.start(); lfo.start();
  }

  update(r: Radio): void {
    if (!this.ctx) return;
    const a = r.audio();
    const t = this.ctx.currentTime;
    this.noiseGain.gain.setTargetAtTime(a.noise ? a.volume * 0.35 : 0, t, 0.05);
    this.sigGain.gain.setTargetAtTime(a.signal ? a.volume * 0.12 : 0, t, 0.05);
  }

  play(s: Sound, vol = 0.15): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const tone = (freq: number, at: number, dur: number, type: OscillatorType = 'sine') => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = freq;
      const t0 = ctx.currentTime + at;
      g.gain.setValueAtTime(vol, t0); g.gain.setValueAtTime(vol, t0 + dur - 0.01); g.gain.linearRampToValueAtTime(0, t0 + dur);
      o.connect(g).connect(ctx.destination); o.start(t0); o.stop(t0 + dur);
    };
    switch (s) {
      case 'beep': tone(1000, 0, 0.08); break;
      case 'longbeep': tone(1000, 0, 0.7); break;
      case 'error': tone(220, 0, 0.25, 'square'); break;
      case 'alarm': tone(900, 0, 0.2, 'square'); tone(1300, 0.22, 0.2, 'square'); break;
      case 'dsc': for (let i = 0; i < 12; i++) tone(i % 2 ? 2100 : 1300, i * 0.12, 0.1); break;
      case 'aqua': tone(140, 0, 2.5, 'sawtooth'); break;
    }
  }
}
