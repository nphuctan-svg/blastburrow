import type { EventKind } from './engine.js';

const melody = [57, 64, 67, 64, 60, 67, 71, 67, 55, 62, 67, 62, 53, 60, 64, 60];
export function createAudio() {
  let ctx: AudioContext | undefined;
  let volume: GainNode | undefined;
  let woodNoise: AudioBuffer | undefined;
  let music: number | undefined;
  let muted = true;
  let note = 0;
  function tone(hz: number, length: number, strength: number, kind: OscillatorType, tail = hz, offset = 0) {
    if (!ctx || !volume || muted) return;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    const now = ctx.currentTime + offset;
    osc.type = kind;
    osc.frequency.setValueAtTime(hz, now);
    osc.frequency.exponentialRampToValueAtTime(tail, now + length);
    amp.gain.setValueAtTime(.0001, now);
    amp.gain.linearRampToValueAtTime(strength, now + .015);
    amp.gain.exponentialRampToValueAtTime(.0001, now + length);
    osc.connect(amp);
    amp.connect(volume);
    osc.start(now);
    osc.stop(now + length);
  }
  function woodCrack(frequency: number, length: number) {
    if (!ctx || !volume || muted) return;
    if (!woodNoise) {
      woodNoise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * .17), ctx.sampleRate);
      const samples = woodNoise.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    }
    const source = ctx.createBufferSource();
    source.buffer = woodNoise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    const amp = ctx.createGain();
    const start = ctx.currentTime + .05;
    amp.gain.setValueAtTime(.0001, start);
    amp.gain.linearRampToValueAtTime(.48, start + .008);
    amp.gain.exponentialRampToValueAtTime(.0001, start + length);
    source.connect(filter).connect(amp).connect(volume);
    source.start(start, 0, length);
  }
  function play(kind: EventKind, resultDelay = 0) {
    switch (kind) {
      case 'plant': tone(380, .10, .11, 'square', 185); break;
      case 'blast': tone(152, .26, .23, 'sawtooth', 30); tone(620, .12, .045, 'triangle', 150); break;
      case 'crate-break':
        woodCrack(1700, .10);
        tone(260, .085, .18, 'triangle', 95, .054); tone(700, .052, .09, 'square', 300, .104);
        break;
      case 'gate':
        woodCrack(950, .16);
        tone(185, .18, .18, 'triangle', 60, .054); tone(480, .078, .08, 'square', 180, .112);
        break;
      case 'hurt': tone(295, .22, .15, 'square', 147); break;
      case 'knockout':
        tone(587, .15, .17, 'square', 493, .118);
        tone(392, .19, .20, 'triangle', 310, .210);
        tone(196, .28, .22, 'triangle', 110, .320);
        break;
      case 'warn': tone(560, .12, .09, 'triangle', 410); break;
      case 'lose':
        tone(261, .25, .10, 'triangle', 261, resultDelay); tone(174, .55, .12, 'triangle', 165, resultDelay + .25); break;
      case 'win':
        [392, 494, 587, 784].forEach((value, i) => tone(value, .29, .1, 'triangle', value, resultDelay + i * .11)); break;
      case 'pickup': case 'relay': case 'rescue':
        tone(520, .12, .10, 'square'); tone(785, .18, .08, 'triangle', 820, .075); break;
      case 'chamber': tone(390, .24, .07, 'triangle', 640); break;
    }
  }
  function toggle() {
    muted = !muted;
    if (!muted) {
      if (!ctx || !volume) {
        ctx = new AudioContext();
        volume = ctx.createGain();
        volume.connect(ctx.destination);
      }
      volume.gain.value = .32;
      void ctx.resume();
      play('pickup');
      music = window.setInterval(() => {
        if (document.hidden) return;
        const midi = melody[note % melody.length];
        const hz = 440 * 2 ** ((midi - 69) / 12);
        tone(hz, .43, .027, 'triangle');
        if (note % 4 === 0) tone(hz / 2, .52, .012, 'sine');
        note++;
      }, 315);
    } else {
      clearInterval(music);
      if (volume) volume.gain.value = 0;
    }
    return !muted;
  }
  return { play, toggle };
}
