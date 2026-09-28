// Web Audio API 효과음. 기본은 오실레이터와 노이즈로 합성하고,
// src/data/assets.ts의 SOUND_ASSETS에 샘플 파일을 등록하면 그 소리를 우선 재생한다.
// 배경음(music.ts)도 이 클래스의 AudioContext와 음악 버스를 공유한다.
import type { SoundAsset } from '../data/assets';

export type SoundName =
  | 'autocannon'
  | 'missile'
  | 'rail'
  | 'laser'
  | 'flame'
  | 'explosion'
  | 'bigExplosion'
  | 'hit'
  | 'shieldHit'
  | 'enemyShot'
  | 'robotHit'
  | 'click'
  | 'buy'
  | 'win'
  | 'lose';

/** 같은 소리가 너무 촘촘히 겹치지 않도록 하는 최소 간격(ms) */
const THROTTLE: Partial<Record<SoundName, number>> = {
  autocannon: 45,
  laser: 90,
  flame: 110,
  hit: 35,
  shieldHit: 60,
  explosion: 40,
  enemyShot: 40,
  robotHit: 60,
};

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicGain!: GainNode;
  private noise!: AudioBuffer;
  private last = new Map<SoundName, number>();
  private samples = new Map<SoundName, { buffers: AudioBuffer[]; volume: number; maxDuration: number }>();
  private settings = { muted: false, sfx: 0.8, music: 0.5 };
  /** false면 샘플이 있어도 합성음을 쓴다 (설정에서 비교용으로 끌 수 있음) */
  useSamples = true;
  /** unlock 직후 호출된다 (BGM 시작 등) */
  onUnlock: (() => void) | null = null;

  constructor(private sampleAssets: Partial<Record<SoundName, SoundAsset>> = {}) {}

  get context(): AudioContext | null {
    return this.ctx;
  }

  get musicBus(): GainNode | null {
    return this.ctx ? this.musicGain : null;
  }

  get noiseBuffer(): AudioBuffer | null {
    return this.ctx ? this.noise : null;
  }

  get muted(): boolean {
    return this.settings.muted;
  }

  /** 볼륨은 0~1. 음소거는 효과음과 배경음 모두에 적용된다. */
  setVolumes(v: { muted: boolean; sfx: number; music: number }): void {
    this.settings = { ...v };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sfxBus.gain.setTargetAtTime(v.muted ? 0 : v.sfx, t, 0.05);
    this.musicGain.gain.setTargetAtTime(v.muted ? 0 : v.music * 0.6, t, 0.05);
  }

  /** 브라우저 정책상 첫 사용자 입력 후에 호출해야 소리가 난다. */
  unlock(): void {
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(comp);
      this.sfxBus = ctx.createGain();
      this.sfxBus.connect(this.master);
      this.musicGain = ctx.createGain();
      this.musicGain.connect(this.master);
      const len = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.setVolumes(this.settings);
      void this.loadSamples();
      if (ctx.state === 'suspended') void ctx.resume();
      this.onUnlock?.();
      return;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** 매니페스트에 등록된 효과음 샘플을 불러온다. 실패한 소리는 합성음을 그대로 쓴다. */
  private async loadSamples(): Promise<void> {
    const ctx = this.ctx!;
    const entries = Object.entries(this.sampleAssets) as [SoundName, SoundAsset][];
    await Promise.all(
      entries.map(async ([name, asset]) => {
        const buffers: AudioBuffer[] = [];
        for (const url of asset.files) {
          try {
            const res = await fetch(import.meta.env.BASE_URL + url);
            if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) continue;
            buffers.push(await ctx.decodeAudioData(await res.arrayBuffer()));
          } catch {
            // 무시하고 합성음 사용
          }
        }
        if (buffers.length) {
          this.samples.set(name, { buffers, volume: asset.volume ?? 1, maxDuration: asset.maxDuration ?? Infinity });
        }
      }),
    );
  }

  private playSample(sample: { buffers: AudioBuffer[]; volume: number; maxDuration: number }): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = sample.buffers[Math.floor(Math.random() * sample.buffers.length)];
    // 같은 샘플이 반복돼도 단조롭지 않게 재생 속도를 살짝 흔든다
    src.playbackRate.value = 0.93 + Math.random() * 0.14;
    const gain = ctx.createGain();
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(sample.volume, t);
    src.connect(gain).connect(this.sfxBus);
    src.start(t);
    // 긴 샘플(분사음 등)은 잘라서 짧게 페이드아웃한다
    const length = src.buffer.duration / src.playbackRate.value;
    if (sample.maxDuration < length) {
      const fade = Math.min(0.12, sample.maxDuration * 0.4);
      gain.gain.setValueAtTime(sample.volume, t + sample.maxDuration - fade);
      gain.gain.linearRampToValueAtTime(0.0001, t + sample.maxDuration);
      src.stop(t + sample.maxDuration + 0.02);
    }
  }

  play(name: SoundName): void {
    if (!this.ctx || this.settings.muted) return;
    const now = performance.now();
    const gap = THROTTLE[name] ?? 15;
    if (now - (this.last.get(name) ?? -Infinity) < gap) return;
    this.last.set(name, now);

    const sample = this.useSamples ? this.samples.get(name) : undefined;
    if (sample) {
      this.playSample(sample);
      return;
    }

    switch (name) {
      case 'autocannon':
        this.tone('square', 220, 90, 0.07, 0.1);
        this.noiseBurst(0.05, 0.12, 'bandpass', 2000, 800);
        break;
      case 'missile':
        this.noiseBurst(0.35, 0.16, 'bandpass', 500, 2200);
        this.tone('sawtooth', 300, 150, 0.2, 0.04);
        break;
      case 'rail':
        this.tone('sawtooth', 2400, 150, 0.35, 0.12);
        this.tone('sine', 90, 40, 0.3, 0.3);
        this.noiseBurst(0.15, 0.2, 'highpass', 3000, 1000);
        break;
      case 'laser':
        this.tone('sine', 1250, 950, 0.09, 0.05);
        this.tone('square', 620, 600, 0.06, 0.015);
        break;
      case 'flame':
        this.noiseBurst(0.16, 0.12, 'bandpass', 700, 500);
        break;
      case 'explosion':
        this.noiseBurst(0.45, 0.35, 'lowpass', 1500, 120);
        this.tone('sine', 110, 40, 0.3, 0.25);
        break;
      case 'bigExplosion':
        this.noiseBurst(1.0, 0.55, 'lowpass', 1000, 60);
        this.tone('sine', 80, 28, 0.8, 0.45);
        break;
      case 'hit':
        this.noiseBurst(0.04, 0.08, 'highpass', 3000, 2000);
        break;
      case 'shieldHit':
        this.tone('sine', 1500, 2200, 0.06, 0.04);
        break;
      case 'enemyShot':
        this.tone('square', 500, 250, 0.12, 0.05);
        break;
      case 'robotHit':
        this.tone('sine', 140, 50, 0.15, 0.3);
        this.noiseBurst(0.08, 0.12, 'lowpass', 800, 300);
        break;
      case 'click':
        this.tone('sine', 800, 780, 0.05, 0.08);
        break;
      case 'buy':
        this.tone('square', 660, 660, 0.08, 0.06);
        this.tone('square', 990, 990, 0.14, 0.06, 0.08);
        break;
      case 'win':
        [523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, 0.22, 0.14, i * 0.12));
        break;
      case 'lose':
        [392, 330, 262, 196].forEach((f, i) => this.tone('triangle', f, f * 0.98, 0.3, 0.14, i * 0.18));
        break;
    }
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseBurst(dur: number, vol: number, filterType: BiquadFilterType, f0: number, f1: number, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(f0, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(this.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }
}
