/* audio.js — every sound is generated at runtime with the Web Audio API.
 * No files, no fetches, so the game still has sound when opened from file://.
 *
 * The signature sound is the thwip: a fast downward pitch sweep on a saw
 * oscillator layered with a filtered noise burst. Swept, not beeped. */
(function (global) {
  'use strict';
  var T = global.THWIP, M = T.M;

  var ctx = null, master = null, tone = null, comp = null;
  var noiseBuf = null;
  var wind = null, windGain = null, windFilter = null;
  var muted = false, started = false;

  function init() {
    if (started) return true;
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();

    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 8;
    comp.attack.value = 0.003;
    comp.release.value = 0.18;

    // one lowpass across everything: clamping it down is the slow-mo effect
    tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 20000;
    tone.Q.value = 0.4;

    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.55;

    tone.connect(comp);
    comp.connect(master);
    master.connect(ctx.destination);

    var len = Math.floor(ctx.sampleRate * 1.2);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // continuous wind bed, gain driven by player speed
    wind = ctx.createBufferSource();
    wind.buffer = noiseBuf;
    wind.loop = true;
    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 700;
    windFilter.Q.value = 0.8;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    wind.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(tone);
    wind.start();

    started = true;
    return true;
  }

  function now() { return ctx.currentTime; }

  function env(node, t0, peak, attack, decay) {
    var g = node.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  function osc(type, f0, f1, t0, dur, peak, dest) {
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    env(g, t0, peak, Math.min(0.012, dur * 0.25), dur);
    o.connect(g); g.connect(dest || tone);
    o.start(t0); o.stop(t0 + dur + 0.06);
    return o;
  }

  function noise(t0, dur, peak, type, f0, f1, q) {
    var s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    var f = ctx.createBiquadFilter();
    f.type = type || 'bandpass';
    f.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(60, f1), t0 + dur);
    f.Q.value = q == null ? 1.2 : q;
    var g = ctx.createGain();
    env(g, t0, peak, 0.005, dur);
    s.connect(f); f.connect(g); g.connect(tone);
    s.start(t0); s.stop(t0 + dur + 0.06);
  }

  var SFX = {
    // the money sound: 1500 -> 190Hz in 90ms, plus a silk-tearing noise burst
    thwip: function (t, o) {
      var len = M.clamp((o && o.L ? o.L : 300) / 1400, 0.16, 0.4);
      osc('sawtooth', 1500, 190, t, 0.09, 0.30);
      osc('square', 900, 260, t, 0.06, 0.10);
      noise(t, 0.11, 0.22, 'bandpass', 5200, 900, 0.9);
      // the rope going tight, pitched by how much line went out
      osc('triangle', 320, 150 + 90 * (1 - len), t + 0.05, 0.10, 0.10);
    },
    release: function (t) {
      osc('sawtooth', 620, 260, t, 0.05, 0.10);
      noise(t, 0.06, 0.09, 'highpass', 2400, 1200, 0.7);
    },
    taut: function (t, o) {
      var v = 0.06 + 0.14 * ((o && o.r) || 0.4);
      osc('triangle', 240, 120, t, 0.10, v);
      noise(t, 0.05, v * 0.5, 'bandpass', 1800, 700, 1.4);
    },
    whiff: function (t) {
      noise(t, 0.16, 0.10, 'bandpass', 1600, 380, 0.7);
      osc('sine', 300, 120, t, 0.12, 0.05);
    },
    // enemy pinned to a surface: wet splat over a low thump
    stick: function (t) {
      osc('sine', 190, 52, t, 0.20, 0.34);
      noise(t, 0.15, 0.26, 'lowpass', 2600, 500, 0.6);
      noise(t + 0.02, 0.10, 0.14, 'bandpass', 900, 300, 1.6);
    },
    clank: function (t) {
      osc('square', 1180, 940, t, 0.09, 0.14);
      osc('square', 1570, 1300, t, 0.07, 0.09);
      noise(t, 0.05, 0.10, 'highpass', 3000, 3000, 0.8);
    },
    land: function (t, o) {
      var v = M.clamp((o && o.impact) || 0.4, 0.15, 1);
      osc('sine', 150 * (0.7 + v * 0.5), 44, t, 0.13, 0.16 + v * 0.22);
      noise(t, 0.09, 0.06 + v * 0.14, 'lowpass', 1200, 300, 0.6);
    },
    scuff: function (t) { noise(t, 0.13, 0.10, 'bandpass', 2600, 1100, 0.8); },
    jump: function (t) {
      osc('triangle', 260, 620, t, 0.10, 0.13);
      noise(t, 0.05, 0.05, 'highpass', 1800, 3000, 0.7);
    },
    shoot: function (t) {
      osc('square', 420, 200, t, 0.12, 0.10);
      noise(t, 0.07, 0.06, 'bandpass', 1200, 600, 1.2);
    },
    telegraph: function (t) { osc('sine', 300, 760, t, 0.42, 0.055); },
    spark: function (t) { noise(t, 0.06, 0.07, 'highpass', 2600, 1600, 0.9); },
    hurt: function (t) {
      osc('square', 300, 90, t, 0.22, 0.22);
      noise(t, 0.14, 0.12, 'lowpass', 900, 300, 0.7);
    },
    respawn: function (t) {
      osc('sawtooth', 120, 420, t, 0.28, 0.14);
      noise(t, 0.3, 0.09, 'bandpass', 500, 2400, 0.6);
    },
    goal: function (t) {
      [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) {
        osc('triangle', f, f, t + i * 0.085, 0.28, 0.20);
        osc('sine', f * 2, f * 2, t + i * 0.085, 0.16, 0.07);
      });
      noise(t, 0.5, 0.07, 'bandpass', 900, 5000, 0.5);
    },
    // boot off a wall: a short scrape into a bright kick
    walljump: function (t) {
      noise(t, 0.07, 0.13, 'bandpass', 3200, 1400, 1.1);
      osc('triangle', 200, 700, t, 0.11, 0.15);
      osc('square', 420, 900, t, 0.05, 0.06);
    },
    slide: function (t) { noise(t, 0.18, 0.05, 'bandpass', 2200, 1500, 1.6); },
    // launch pad: a rising whoop with a thump underneath
    boost: function (t) {
      osc('sawtooth', 260, 1500, t, 0.16, 0.20);
      osc('sine', 90, 60, t, 0.14, 0.24);
      noise(t, 0.14, 0.12, 'highpass', 900, 4200, 0.6);
    },
    // a ring giving way: brittle snap, then the line going loose
    snap: function (t) {
      osc('square', 1400, 300, t, 0.06, 0.16);
      noise(t, 0.09, 0.16, 'bandpass', 4200, 800, 1.4);
      osc('triangle', 240, 90, t + 0.03, 0.12, 0.08);
    },
    die: function (t) {
      osc('sawtooth', 300, 48, t, 0.30, 0.26);
      osc('square', 180, 40, t, 0.24, 0.14);
      noise(t, 0.22, 0.16, 'lowpass', 1400, 200, 0.6);
    },
    slowin: function (t) { osc('sine', 700, 300, t, 0.16, 0.07); },
    slowout: function (t) { osc('sine', 300, 760, t, 0.12, 0.06); },
    ui: function (t) { osc('square', 660, 880, t, 0.05, 0.07); },
    best: function (t) {
      [784, 988, 1319].forEach(function (f, i) {
        osc('square', f, f, t + i * 0.07, 0.18, 0.12);
      });
    }
  };

  var Audio = {
    ready: function () { return started; },
    init: init,
    resume: function () {
      if (!init()) return;
      if (ctx.state === 'suspended') ctx.resume();
    },
    play: function (name, opts) {
      if (!started || muted || !SFX[name]) return;
      try { SFX[name](now() + 0.001, opts); } catch (e) { /* never let audio kill a frame */ }
    },
    /* wind rises with speed; the master lowpass closes down during slow-mo */
    setSpeed: function (speed01) {
      if (!started) return;
      var g = M.clamp(speed01, 0, 1);
      windGain.gain.setTargetAtTime(g * g * 0.22, now(), 0.08);
      windFilter.frequency.setTargetAtTime(500 + g * 1500, now(), 0.1);
    },
    setSlowmo: function (t) {
      if (!started) return;
      tone.frequency.setTargetAtTime(M.lerp(20000, 850, M.clamp(t, 0, 1)), now(), 0.05);
    },
    toggleMute: function () {
      muted = !muted;
      if (started) master.gain.setTargetAtTime(muted ? 0 : 0.55, now(), 0.02);
      return muted;
    },
    isMuted: function () { return muted; }
  };

  T.Audio = Audio;
})(typeof window !== 'undefined' ? window : globalThis);
