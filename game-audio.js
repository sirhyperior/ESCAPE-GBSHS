(function (root) {
  'use strict';

  const MASTER_GAIN = 0.72;
  const AudioContext = root.AudioContext || root.webkitAudioContext;

  function create() {
    const scare = new Audio('full-golden-freddy-scream.mp3');
    scare.preload = 'auto';
    scare.volume = MASTER_GAIN;
    let context;
    let output;
    let noise;
    let enabled = true;
    let stride = 0.25;
    let breath = 0.45;
    let pulse = 1;

    async function unlock() {
      if (!enabled || !AudioContext) return false;
      try {
        if (!context) {
          context = new AudioContext();
          output = context.createGain();
          output.gain.value = MASTER_GAIN;
          output.connect(context.destination);
          noise = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
          const samples = noise.getChannelData(0);
          for (let index = 0; index < samples.length; index += 1) {
            samples[index] = Math.random() * 2 - 1;
          }
        }
        if (context.state !== 'running') await context.resume();
        return enabled && context.state === 'running';
      } catch {
        return false;
      }
    }

    function setEnabled(value) {
      enabled = Boolean(value);
      if (!enabled) stopScare();
      stride = 0.25;
      breath = 0.45;
      pulse = 1;
      if (!output) return;

      const now = context.currentTime;
      output.gain.cancelScheduledValues(now);
      output.gain.setTargetAtTime(enabled ? MASTER_GAIN : 0, now, 0.012);
      if (enabled && context.state !== 'running') void unlock();
    }

    function stopScare() {
      scare.pause();
      scare.currentTime = 0;
    }

    function ready() {
      return enabled && context?.state === 'running' && noise;
    }

    function voice(nodes, at, attack, duration, volume) {
      const envelope = context.createGain();
      envelope.gain.setValueAtTime(0.0001, at);
      envelope.gain.linearRampToValueAtTime(volume, at + attack);
      envelope.gain.exponentialRampToValueAtTime(0.0001, at + duration);
      nodes.push(envelope);

      for (let index = 1; index < nodes.length; index += 1) nodes[index - 1].connect(nodes[index]);
      envelope.connect(output);
      nodes[0].onended = () => nodes.forEach(node => node.disconnect());
    }

    function noiseVoice(at, duration, attack, volume, pitch, tailPitch) {
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      source.buffer = noise;
      filter.type = 'bandpass';
      filter.Q.value = 0.75;
      filter.frequency.setValueAtTime(pitch, at);
      filter.frequency.exponentialRampToValueAtTime(tailPitch, at + duration);
      voice([source, filter], at, attack, duration, volume);
      source.start(at, Math.random() * (noise.duration - duration));
      source.stop(at + duration);
    }

    function tone(at, duration, volume, pitch, tailPitch, type = 'triangle') {
      const oscillator = context.createOscillator();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(pitch, at);
      oscillator.frequency.exponentialRampToValueAtTime(tailPitch, at + duration);
      voice([oscillator], at, 0.012, duration, volume);
      oscillator.start(at);
      oscillator.stop(at + duration);
    }

    function footstep(now, sprinting) {
      const pitch = 91 + Math.random() * 15;
      tone(now, 0.092, sprinting ? 0.12 : 0.075, pitch, 49);
      noiseVoice(now + 0.018, 0.102, 0.009, sprinting ? 0.16 : 0.11, 1090, 600);
    }

    function breathing(now, strained) {
      const length = strained ? 0.35 : 0.47;
      const volume = strained ? 0.16 : 0.071;
      noiseVoice(now, length, length * 0.46, volume * 0.7, 670, 1000);
      noiseVoice(now + length + 0.07, length * 1.15, length * 0.21, volume, 940, 500);
    }

    function heartbeat(now) {
      tone(now, 0.16, 0.24, 85, 47);
      tone(now + 0.118, 0.135, 0.16, 69, 42);
    }

    function update({ speed, sprinting, exhausted, alerted }, dt) {
      if (!ready() || !Number.isFinite(dt) || dt <= 0) return;
      const elapsed = Math.min(dt, 0.1);
      const now = context.currentTime + 0.006;
      const moving = speed > 0.15;
      const strained = sprinting || exhausted;

      if (moving) {
        stride += Math.min(speed, 8) * elapsed / (sprinting ? 1.12 : 0.93);
        if (stride >= 1) {
          stride %= 1;
          footstep(now, sprinting);
        }
      } else {
        stride = 0.25;
      }

      breath += elapsed / (strained ? 1.65 : moving ? 2.85 : 4.1);
      if (breath >= 1) {
        breath %= 1;
        breathing(now, strained);
      }

      if (alerted) {
        pulse += elapsed / (strained ? 0.64 : 0.78);
        if (pulse >= 1) {
          pulse %= 1;
          heartbeat(now);
        }
      } else {
        pulse = 1;
      }
    }

    function play(event) {
      if (event === 'scared') {
        if (enabled) {
          scare.currentTime = 0;
          void scare.play().catch(() => {});
        }
        return;
      }
      if (!ready()) return;
      const now = context.currentTime + 0.006;
      if (event === 'floor') {
        tone(now, 0.35, 0.082, 130, 57);
        noiseVoice(now, 0.34, 0.03, 0.074, 760, 390);
      } else if (event === 'caught') {
        tone(now, 0.34, 0.18, 194, 58, 'sawtooth');
        noiseVoice(now, 0.39, 0.018, 0.14, 1350, 460);
      } else if (event === 'escaped') {
        tone(now, 0.38, 0.09, 131, 162, 'sine');
        tone(now + 0.095, 0.46, 0.085, 196, 231, 'sine');
      }
    }

    function playDialogue(character) {
      if (!ready()) return;
      const pitch = 294 + (character.codePointAt(0) % 5) * 22;
      tone(context.currentTime + 0.006, 0.036, 0.025, pitch, pitch * 0.9, 'square');
    }

    return { unlock, setEnabled, update, play, playDialogue, stopScare };
  }

  root.DormAudio = { create };
})(globalThis);
