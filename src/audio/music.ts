import type { Sfx } from './sfx';

// 절차적 배경음. 16분음표 단위 스텝 시퀀서를 Web Audio 시계에 맞춰 미리 예약한다.
// MUSIC_ASSETS에 파일이 등록되어 있으면 Sfx 쪽에서 파일 재생을 우선한다.

export type TrackName = 'menu' | 'battle';

interface Track {
  bpm: number;
  /** 한 마디(16스텝)마다 바뀌는 코드: 루트 MIDI 번호 + 3화음 구성음 */
  chords: { root: number; notes: number[] }[];
  step(t: number, step: number, bar: number, chord: { root: number; notes: number[] }, dur: number): void;
}

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// Am - F - C - G
const PROGRESSION = [
  { root: 45, notes: [57, 60, 64] },
  { root: 41, notes: [53, 57, 60] },
  { root: 48, notes: [55, 60, 64] },
  { root: 43, notes: [55, 59, 62] },
];

// Am - Am - F - G (전투용: 긴장감)
const BATTLE_PROGRESSION = [
  { root: 45, notes: [57, 60, 64] },
  { root: 45, notes: [57, 60, 64] },
  { root: 41, notes: [57, 60, 65] },
  { root: 43, notes: [55, 59, 62] },
];

export class Music {
  private current: TrackName | null = null;
  private timer: number | null = null;
  private nextTime = 0;
  private stepIndex = 0;
  private bus: GainNode | null = null;
  private fileEl: HTMLAudioElement | null = null;

  constructor(
    private sfx: Sfx,
    private files: Partial<Record<TrackName, string>>,
  ) {}

  play(name: TrackName): void {
    if (this.current === name) return;
    this.stop();
    this.current = name;
    const ctx = this.sfx.context;
    if (!ctx) return; // 오디오가 아직 잠겨 있으면 unlock 후 resume()에서 시작한다

    const file = this.files[name];
    if (file) {
      this.playFile(file);
      return;
    }
    this.bus = ctx.createGain();
    this.bus.gain.setValueAtTime(0, ctx.currentTime);
    this.bus.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.5);
    this.bus.connect(this.sfx.musicBus!);
    this.nextTime = ctx.currentTime + 0.1;
    this.stepIndex = 0;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  /** 오디오 잠금이 풀린 뒤, 재생하려던 곡을 시작한다 */
  resume(): void {
    const name = this.current;
    if (!name || this.timer !== null || this.fileEl) return;
    this.current = null;
    this.play(name);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    const ctx = this.sfx.context;
    if (this.bus && ctx) {
      const bus = this.bus;
      bus.gain.cancelScheduledValues(ctx.currentTime);
      bus.gain.setValueAtTime(bus.gain.value, ctx.currentTime);
      bus.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
      window.setTimeout(() => bus.disconnect(), 800);
    }
    this.bus = null;
    if (this.fileEl) {
      this.fileEl.pause();
      this.fileEl = null;
    }
    this.current = null;
  }

  private playFile(url: string): void {
    const ctx = this.sfx.context!;
    const el = new Audio(import.meta.env.BASE_URL + url);
    el.loop = true;
    const src = ctx.createMediaElementSource(el);
    src.connect(this.sfx.musicBus!);
    void el.play().catch(() => {});
    this.fileEl = el;
  }

  private schedule(): void {
    const ctx = this.sfx.context;
    if (!ctx || !this.current) return;
    const track = this.current === 'battle' ? this.battleTrack : this.menuTrack;
    const stepDur = 60 / track.bpm / 4;
    while (this.nextTime < ctx.currentTime + 0.12) {
      const bar = Math.floor(this.stepIndex / 16);
      const chord = track.chords[bar % track.chords.length];
      track.step(this.nextTime, this.stepIndex % 16, bar, chord, stepDur);
      this.nextTime += stepDur;
      this.stepIndex++;
    }
  }

  // ─── 악기 ────────────────────────────────────────────

  private voice(type: OscillatorType, freq: number, t: number, dur: number, vol: number, cutoff = 4000, attack = 0.005): void {
    const ctx = this.sfx.context!;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(vol, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(filter).connect(gain).connect(this.bus!);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private kick(t: number): void {
    const ctx = this.sfx.context!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    osc.connect(gain).connect(this.bus!);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  private noiseHit(t: number, dur: number, vol: number, type: BiquadFilterType, freq: number): void {
    const ctx = this.sfx.context!;
    const src = ctx.createBufferSource();
    src.buffer = this.sfx.noiseBuffer!;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(this.bus!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  // ─── 곡 ──────────────────────────────────────────────

  /** 메뉴: 느린 패드 + 드문드문 울리는 아르페지오 */
  private menuTrack: Track = {
    bpm: 80,
    chords: PROGRESSION,
    step: (t, step, _bar, chord, dur) => {
      if (step === 0) {
        for (const n of chord.notes) {
          this.voice('sawtooth', midiHz(n), t, dur * 16, 0.035, 900, 0.8);
          this.voice('sawtooth', midiHz(n) * 1.004, t, dur * 16, 0.03, 900, 0.8);
        }
        this.voice('sine', midiHz(chord.root - 12), t, dur * 16, 0.12, 400, 0.5);
      }
      if (step % 4 === 2) {
        const n = chord.notes[(step / 4) % chord.notes.length | 0] + 12;
        this.voice('triangle', midiHz(n), t, dur * 6, 0.05, 3000);
      }
    },
  };

  /** 전투: 킥·스네어·하이햇 + 8분음표 베이스 + 16분음표 아르페지오 */
  private battleTrack: Track = {
    bpm: 126,
    chords: BATTLE_PROGRESSION,
    step: (t, step, bar, chord, dur) => {
      if (step % 4 === 0) this.kick(t);
      if (step === 4 || step === 12) this.noiseHit(t, 0.18, 0.18, 'bandpass', 1800);
      if (step % 2 === 0) this.noiseHit(t, 0.04, 0.05, 'highpass', 7000);
      if (step % 2 === 0) {
        const octave = step % 4 === 2 ? 12 : 0;
        this.voice('sawtooth', midiHz(chord.root + octave), t, dur * 1.8, 0.09, 700);
      }
      // 4마디 중 뒤 2마디에만 아르페지오를 넣어 흐름에 변화를 준다
      if (bar % 4 >= 2) {
        const pattern = [0, 1, 2, 1];
        const n = chord.notes[pattern[step % 4]] + 12;
        this.voice('square', midiHz(n), t, dur * 0.9, 0.025, 2500);
      }
    },
  };
}
