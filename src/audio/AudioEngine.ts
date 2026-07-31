import type { SurfaceKind } from '@/maps/MapTypes';
import type { Vec3 } from '@/util/math';
import { clamp } from '@/util/math';

/**
 * Per-surface footstep and impact character.
 *
 * `cutoff` is the filter corner in Hz and `level` a gain multiplier: a catwalk grating rings
 * bright and metallic, a rubberised floor thuds, glass ticks. This is the cheapest possible way to
 * make the two decks of the arena sound different from each other while walking between them.
 */
const SURFACE_TONE: Record<SurfaceKind, { cutoff: number; level: number; ring: number }> = {
  floor: { cutoff: 620, level: 1, ring: 0 },
  wall: { cutoff: 700, level: 0.9, ring: 0 },
  catwalk: { cutoff: 2400, level: 1.15, ring: 0.5 },
  barrier: { cutoff: 900, level: 0.95, ring: 0.15 },
  pillar: { cutoff: 850, level: 0.9, ring: 0.1 },
  ramp: { cutoff: 1500, level: 1.05, ring: 0.3 },
  glass: { cutoff: 3600, level: 0.8, ring: 0.7 },
  led: { cutoff: 1200, level: 0.7, ring: 0.2 },
  trim: { cutoff: 1200, level: 0.7, ring: 0.2 },
};

/**
 * Spatial audio built entirely from synthesis.
 *
 * Every sound in Milestone 1 is generated at runtime rather than streamed from a file. That is a
 * deliberate call: it keeps the build asset-free while the gameplay is still moving, gives us
 * per-shot variation for free, and the mixer graph (bus -> reverb -> master) is exactly the one
 * that authored assets will slot into during the audio pass, so nothing here is throwaway.
 */

export interface AudioMixSettings {
  master: number;
  sfx: number;
  music: number;
  voice: number;
}

export const defaultMixSettings = (): AudioMixSettings => ({
  master: 0.8,
  sfx: 1,
  music: 0.5,
  voice: 1,
});

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private voiceBus!: GainNode;
  private reverbSend!: GainNode;
  private convolver!: ConvolverNode;
  private compressor!: DynamicsCompressorNode;
  private listener: AudioListener | null = null;
  private mix: AudioMixSettings = defaultMixSettings();
  private musicTimer = 0;
  private musicStep = 0;
  private musicIntensity = 0;
  private started = false;

  /** Must be called from a user gesture — browsers refuse to start audio otherwise. */
  start(): void {
    if (this.started) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor({ latencyHint: 'interactive' });
    const ctx = this.ctx;

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -14;
    this.compressor.knee.value = 22;
    this.compressor.ratio.value = 5;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.22;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.mix.master;

    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.voiceBus = ctx.createGain();
    this.sfxBus.gain.value = this.mix.sfx;
    this.musicBus.gain.value = this.mix.music;
    this.voiceBus.gain.value = this.mix.voice;

    this.convolver = ctx.createConvolver();
    this.convolver.buffer = this.buildImpulseResponse(1.9, 0.55);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.32;

    this.sfxBus.connect(this.compressor);
    this.musicBus.connect(this.compressor);
    this.voiceBus.connect(this.compressor);
    this.sfxBus.connect(this.reverbSend);
    this.reverbSend.connect(this.convolver);
    this.convolver.connect(this.compressor);
    this.compressor.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);

    this.listener = ctx.listener;
    this.started = true;
    this.startAmbience();
  }

  get isStarted(): boolean {
    return this.started;
  }

  resume(): void {
    void this.ctx?.resume();
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  setMix(mix: AudioMixSettings): void {
    this.mix = mix;
    if (!this.ctx) return;
    this.masterGain.gain.value = mix.master;
    this.sfxBus.gain.value = mix.sfx;
    this.musicBus.gain.value = mix.music;
    this.voiceBus.gain.value = mix.voice;
  }

  /** Wetness/decay come from the arena's reverb zones, so an atrium sounds unlike a corridor. */
  setReverb(wetness: number, decaySeconds: number): void {
    if (!this.ctx) return;
    this.reverbSend.gain.setTargetAtTime(clamp(wetness * 0.55, 0, 0.7), this.ctx.currentTime, 0.4);
    const desired = Math.round(decaySeconds * 10);
    if (desired !== this.currentDecayKey) {
      this.currentDecayKey = desired;
      this.convolver.buffer = this.buildImpulseResponse(decaySeconds, 0.55);
    }
  }
  private currentDecayKey = 19;

  updateListener(position: Vec3, forward: Vec3, up: Vec3): void {
    if (!this.ctx || !this.listener) return;
    const l = this.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(position.x, t, 0.02);
      l.positionY.setTargetAtTime(position.y, t, 0.02);
      l.positionZ.setTargetAtTime(position.z, t, 0.02);
      l.forwardX.setTargetAtTime(forward.x, t, 0.02);
      l.forwardY.setTargetAtTime(forward.y, t, 0.02);
      l.forwardZ.setTargetAtTime(forward.z, t, 0.02);
      l.upX.setTargetAtTime(up.x, t, 0.02);
      l.upY.setTargetAtTime(up.y, t, 0.02);
      l.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      // Safari still ships the deprecated setter API.
      (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(
        position.x,
        position.y,
        position.z,
      );
      (
        l as unknown as { setOrientation(...args: number[]): void }
      ).setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  /** Creates a panner for a world-space one-shot, or routes flat for first-person sounds. */
  private destination(position?: Vec3): AudioNode {
    if (!position || !this.ctx) return this.sfxBus;
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 3;
    panner.maxDistance = 90;
    panner.rolloffFactor = 1.15;
    panner.positionX.value = position.x;
    panner.positionY.value = position.y;
    panner.positionZ.value = position.z;
    panner.connect(this.sfxBus);
    return panner;
  }

  // --- One-shots ------------------------------------------------------------

  /**
   * Laser discharge: a fast downward frequency sweep through a resonant filter, with a noise
   * transient for the "crack". Pitch varies per team so you can hear who is shooting.
   */
  playLaser(position: Vec3 | undefined, teamPitch: number, isLocal: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const out = this.destination(position);

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const base = 1350 * teamPitch;
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(base * 0.16, now + 0.13);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 7;
    filter.frequency.setValueAtTime(base * 1.4, now);
    filter.frequency.exponentialRampToValueAtTime(base * 0.3, now + 0.13);

    const gain = ctx.createGain();
    const level = isLocal ? 0.34 : 0.26;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(level, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.17);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.19);

    // Transient click gives the shot its attack.
    this.playNoiseBurst(out, 0.02, isLocal ? 0.16 : 0.11, 2600, 'highpass');
    this.disposeLater(out, now + 0.25);
  }

  /** Impact: short filtered noise plus a low thump, brighter when it hits a player. */
  playImpact(position: Vec3, hitActor: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const out = this.destination(position);
    this.playNoiseBurst(out, hitActor ? 0.09 : 0.06, hitActor ? 0.3 : 0.2, hitActor ? 1800 : 950, 'bandpass');

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(hitActor ? 260 : 150, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.1);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.14);
    this.disposeLater(out, now + 0.25);
  }

  /** Rising two-tone chirp while the cell cycles. */
  playRechargeStart(isLocal: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !isLocal) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 1.7);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.09, now + 0.1);
    gain.gain.setValueAtTime(0.09, now + 1.5);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.85);
    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(now);
    osc.stop(now + 1.9);
  }

  playRechargeEnd(isLocal: boolean): void {
    if (!this.ctx || !isLocal) return;
    this.playTone(1180, 0.08, 0.13, 'square');
    this.playTone(1760, 0.1, 0.09, 'square', 0.06);
  }

  /** Hit confirmation — the single most important feedback sound in the game. */
  playHitMarker(killed: boolean): void {
    if (!this.ctx) return;
    if (killed) {
      this.playTone(1320, 0.09, 0.2, 'square');
      this.playTone(1980, 0.14, 0.16, 'square', 0.05);
    } else {
      this.playTone(1560, 0.055, 0.16, 'square');
    }
  }

  playFootstep(
    position: Vec3 | undefined,
    running: boolean,
    isLocal: boolean,
    surface: SurfaceKind = 'floor',
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const tone = SURFACE_TONE[surface] ?? SURFACE_TONE.floor;
    const out = this.destination(isLocal ? undefined : position);
    const level = (isLocal ? 0.07 : 0.13) * tone.level;
    this.playNoiseBurst(
      out,
      running ? 0.07 : 0.09,
      level,
      tone.cutoff * (running ? 1.35 : 1),
      surface === 'catwalk' || surface === 'glass' ? 'bandpass' : 'lowpass',
    );
    // Metal decks and glass add a short ring on top of the thud.
    if (tone.ring > 0.2) {
      this.playRing(out, tone.cutoff * 2.2, 0.09 * tone.ring * (isLocal ? 0.7 : 1), 0.14);
    }
    if (!isLocal) this.disposeLater(out, ctx.currentTime + 0.3);
  }

  /**
   * Ricochet: a descending whistle. Only played for grazing hits on hard surfaces, which is what
   * makes it an occasional accent rather than a constant noise on every miss.
   */
  playRicochet(position: Vec3, surface: SurfaceKind): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const tone = SURFACE_TONE[surface] ?? SURFACE_TONE.floor;
    const now = ctx.currentTime;
    const out = this.destination(position);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const start = 2100 + tone.cutoff * 0.4;
    osc.frequency.setValueAtTime(start, now);
    osc.frequency.exponentialRampToValueAtTime(start * 0.28, now + 0.34);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);

    osc.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + 0.38);
    this.disposeLater(out, now + 0.45);
  }

  /** Short resonant ring, used to give metal surfaces their character. */
  private playRing(out: AudioNode, frequency: number, level: number, duration: number): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(out);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  /**
   * Ambient arena bed: a low electrical hum with a slow beat between two detuned oscillators, plus
   * filtered noise for air handling. Started once and left running — it is the floor the whole mix
   * sits on, and its absence is what makes an arena feel like an empty test level.
   */
  private startAmbience(): void {
    const ctx = this.ctx!;
    const bed = ctx.createGain();
    bed.gain.value = 0.055;
    bed.connect(this.sfxBus);
    this.ambienceGain = bed;

    // Mains hum at 50 Hz plus a slightly detuned partner produces a slow, organic beating.
    for (const [freq, level] of [
      [50, 0.5],
      [50.7, 0.4],
      [100, 0.18],
    ] as Array<[number, number]>) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.value = level;
      osc.connect(gain);
      gain.connect(bed);
      osc.start();
      this.ambienceNodes.push(osc);
    }

    // Air handling: looping filtered noise.
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(2);
    noise.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.6;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.35;
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(bed);
    noise.start();
    this.ambienceNodes.push(noise);
  }

  private ambienceGain: GainNode | null = null;
  private readonly ambienceNodes: Array<OscillatorNode | AudioBufferSourceNode> = [];

  playJump(position: Vec3 | undefined, isLocal: boolean): void {
    if (!this.ctx) return;
    const out = this.destination(isLocal ? undefined : position);
    this.playNoiseBurst(out, 0.06, isLocal ? 0.08 : 0.12, 1100, 'bandpass');
    if (!isLocal) this.disposeLater(out, this.ctx.currentTime + 0.2);
  }

  playLand(position: Vec3 | undefined, impactSpeed: number, isLocal: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const intensity = clamp(impactSpeed / 12, 0.15, 1);
    const out = this.destination(isLocal ? undefined : position);
    this.playNoiseBurst(out, 0.12, intensity * (isLocal ? 0.2 : 0.26), 420, 'lowpass');
    if (!isLocal) this.disposeLater(out, ctx.currentTime + 0.3);
  }

  playSlide(position: Vec3 | undefined, isLocal: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const out = this.destination(isLocal ? undefined : position);
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(0.8);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(2400, now);
    filter.frequency.exponentialRampToValueAtTime(500, now + 0.7);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(isLocal ? 0.16 : 0.2, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.75);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    noise.start(now);
    noise.stop(now + 0.8);
    if (!isLocal) this.disposeLater(out, now + 0.9);
  }

  playDamageTaken(): void {
    if (!this.ctx) return;
    this.playTone(180, 0.16, 0.24, 'sawtooth');
  }

  playDeath(isLocal: boolean): void {
    if (!this.ctx || !isLocal) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.85);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(now);
    osc.stop(now + 0.95);
  }

  playRespawn(): void {
    if (!this.ctx) return;
    this.playTone(440, 0.1, 0.16, 'triangle');
    this.playTone(660, 0.12, 0.14, 'triangle', 0.09);
    this.playTone(880, 0.18, 0.12, 'triangle', 0.18);
  }

  /**
   * Announcer stinger. Real voice-over lands in the audio pass; until then this plays the
   * attention cue and the HUD carries the words as a subtitle, which is also the accessibility
   * path we need regardless.
   */
  playAnnouncement(priority: 'low' | 'high'): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const base = priority === 'high' ? 620 : 480;
    for (let i = 0; i < (priority === 'high' ? 3 : 2); i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime + i * 0.11;
      osc.type = 'square';
      osc.frequency.setValueAtTime(base * (1 + i * 0.26), t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.11, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      osc.connect(gain);
      gain.connect(this.voiceBus);
      osc.start(t);
      osc.stop(t + 0.12);
    }
  }

  // --- Dynamic music --------------------------------------------------------

  /**
   * A generative pulse bed. Intensity rises with nearby combat and drives filter cutoff, note
   * density and the sub-bass layer, so the score reacts to the fight instead of looping past it.
   */
  stepMusic(dt: number, targetIntensity: number): void {
    const ctx = this.ctx;
    if (!ctx || this.mix.music <= 0.001) return;
    this.musicIntensity += (targetIntensity - this.musicIntensity) * Math.min(1, dt * 0.8);

    const bpm = 124 + this.musicIntensity * 18;
    const stepDuration = 60 / bpm / 4;
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    this.musicTimer += stepDuration;

    const step = this.musicStep++ % 16;
    const scale = [0, 3, 5, 7, 10, 12, 15]; // Minor pentatonic + octave, reads as tense but not sad.
    const root = 55; // A1

    // Kick on the quarter.
    if (step % 4 === 0) this.playMusicKick();
    // Hats fill in as intensity rises.
    if (step % 2 === 1 && this.musicIntensity > 0.25) this.playMusicHat(this.musicIntensity);
    // Arpeggio.
    if (step % 2 === 0 || this.musicIntensity > 0.6) {
      const degree = scale[(step * 3 + this.musicStep) % scale.length];
      const octave = this.musicIntensity > 0.5 && step % 8 === 6 ? 2 : 1;
      this.playMusicNote(root * Math.pow(2, degree / 12) * 4 * octave, stepDuration * 1.8);
    }
    // Sub-bass pulse under heavy combat.
    if (this.musicIntensity > 0.45 && step % 8 === 0) {
      this.playMusicNote(root, stepDuration * 6, 'sine', 0.22);
    }
  }

  private playMusicKick(): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, now);
    osc.frequency.exponentialRampToValueAtTime(42, now + 0.11);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.34, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    osc.connect(gain);
    gain.connect(this.musicBus);
    osc.start(now);
    osc.stop(now + 0.26);
  }

  private playMusicHat(intensity: number): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer(0.06);
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 7000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.05 * intensity, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicBus);
    noise.start(now);
    noise.stop(now + 0.07);
  }

  private playMusicNote(
    frequency: number,
    duration: number,
    type: OscillatorType = 'sawtooth',
    level = 0.075,
  ): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 6;
    filter.frequency.value = 700 + this.musicIntensity * 4200;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(level, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.musicBus);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  // --- Primitives -----------------------------------------------------------

  private playTone(
    frequency: number,
    duration: number,
    level: number,
    type: OscillatorType,
    delay = 0,
  ): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(level, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  private playNoiseBurst(
    out: AudioNode,
    duration: number,
    level: number,
    cutoff: number,
    filterType: BiquadFilterType,
  ): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer(duration + 0.02);
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = cutoff;
    filter.Q.value = filterType === 'bandpass' ? 1.2 : 0.7;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    source.start(now);
    source.stop(now + duration + 0.02);
  }

  /** Small cache of white-noise buffers keyed by rounded duration. */
  private readonly noiseCache = new Map<number, AudioBuffer>();

  private noiseBuffer(duration: number): AudioBuffer {
    const ctx = this.ctx!;
    const key = Math.max(1, Math.round(duration * 100));
    const cached = this.noiseCache.get(key);
    if (cached) return cached;
    const length = Math.max(1, Math.floor(ctx.sampleRate * (key / 100)));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseCache.set(key, buffer);
    return buffer;
  }

  /** Exponentially decaying noise makes a serviceable room impulse response. */
  private buildImpulseResponse(decaySeconds: number, damping: number): AudioBuffer {
    const ctx = this.ctx!;
    const length = Math.max(1, Math.floor(ctx.sampleRate * decaySeconds));
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let last = 0;
      for (let i = 0; i < length; i++) {
        const envelope = Math.pow(1 - i / length, 2.2);
        const white = Math.random() * 2 - 1;
        // One-pole lowpass gives the tail an absorptive, room-like character.
        last = last * damping + white * (1 - damping);
        data[i] = last * envelope;
      }
    }
    return buffer;
  }

  private disposeLater(node: AudioNode, when: number): void {
    const ctx = this.ctx;
    if (!ctx || node === this.sfxBus) return;
    const delay = Math.max(0, (when - ctx.currentTime) * 1000) + 60;
    window.setTimeout(() => node.disconnect(), delay);
  }

  dispose(): void {
    for (const node of this.ambienceNodes) {
      try {
        node.stop();
      } catch {
        /* Already stopped — nothing to do. */
      }
    }
    this.ambienceNodes.length = 0;
    this.ambienceGain?.disconnect();
    void this.ctx?.close();
    this.ctx = null;
    this.started = false;
    this.noiseCache.clear();
  }
}
