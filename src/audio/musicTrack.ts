/**
 * MusicTrack — a WebAudio-backed stand-in for the little slice of
 * HTMLAudioElement the music modules use (src/play/pause/loop/volume/
 * currentTime/paused/ended/onended). Long-form music used to ride plain
 * `new Audio(...)` elements; it now routes through the shared AudioContext.
 *
 * WHY: on Quest, an audible <audio> element activates Android's media-session
 * bridge, and Meta Browser's packaged-PWA launch path crashes in that bridge
 * (NullPointerException in MediaSessionImpl.mediaSessionStateChanged — the
 * whole browser process dies behind a "browser crashed" dialog). It only
 * bites once the origin has earned media-engagement autoplay — i.e. for
 * players who revisit often — because only then does the lobby track start
 * during the launch splash. WebAudio playback never registers a media
 * session, so music through here can't trigger it.
 *
 * Decoded buffers are cached per URL, so re-plays and src round-trips don't
 * refetch. Playback survives the same autoplay rules as before: if the
 * context can't run yet, the track just stays silent until it's unlocked.
 */

import { audioContext } from './sfx.js';

interface LoadedTrack {
  buffer: AudioBuffer;
  /** Seconds of silence at the head of the file. Playback starts here and
   *  loops back here — "Smoldering" ships with a 2s digital-silence lead-in
   *  that made every launch cue sound late (and punched a 2s hole into each
   *  loop), so the silent head is measured once at decode and skipped. */
  head: number;
}

const bufferCache = new Map<string, Promise<LoadedTrack | null>>();

function firstAudibleSecond(buffer: AudioBuffer): number {
  // Windowed RMS, not first-sample-over-threshold: real exports carry dither
  // and stray clicks in their "silent" head (Smoldering has a -66 dB blip in
  // its first quarter-second, followed by 1.5s of true zeros), so the head
  // ends at the first WINDOW with sustained energy, not the first hot sample.
  const data = buffer.getChannelData(0);
  const win = Math.max(1, Math.floor(buffer.sampleRate * 0.05));
  const threshold = 0.003; // window RMS ~-50 dBFS — music clears it, dither doesn't
  for (let s = 0; s < data.length; s += win) {
    const end = Math.min(s + win, data.length);
    let sum = 0;
    for (let i = s; i < end; i++) sum += data[i] * data[i];
    if (Math.sqrt(sum / (end - s)) > threshold) {
      return Math.max(0, s / buffer.sampleRate - 0.05); // keep a 50ms pre-roll
    }
  }
  return 0; // all-silent (or empty) — treat as headless
}

function loadBuffer(url: string): Promise<LoadedTrack | null> {
  let pending = bufferCache.get(url);
  if (!pending) {
    pending = (async () => {
      const ctx = audioContext();
      if (!ctx) return null;
      try {
        const res = await fetch(url);
        const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
        return { buffer, head: firstAudibleSecond(buffer) };
      } catch {
        return null; // fetch/decode failed — the track just stays silent
      }
    })();
    bufferCache.set(url, pending);
  }
  return pending;
}

export class MusicTrack {
  loop = false;
  onended: (() => void) | null = null;

  private _src = '';
  private _volume = 1;
  private _gain: GainNode | null = null;
  private _source: AudioBufferSourceNode | null = null;
  private _buffer: AudioBuffer | null = null;
  private _offset = 0; // paused/seek position within the buffer, seconds
  private _startedAt = 0; // ctx.currentTime when the current source began
  private _playing = false;
  private _ended = false;
  private _playSeq = 0; // invalidates in-flight play() decodes on pause/src swap

  constructor(src?: string) {
    if (src) this.src = src;
  }

  get src(): string {
    return this._src;
  }

  /** Swapping the source stops playback and rewinds, like an element would. */
  set src(url: string) {
    if (url === this._src) return;
    this._playSeq += 1;
    this.stopSource();
    this._playing = false;
    this._ended = false;
    this._offset = 0;
    this._buffer = null;
    this._src = url;
    void loadBuffer(url); // start decoding now so play() lands fast
  }

  get volume(): number {
    return this._volume;
  }

  set volume(v: number) {
    this._volume = v;
    if (this._gain) this._gain.gain.value = v;
  }

  get paused(): boolean {
    return !this._playing;
  }

  get ended(): boolean {
    return this._ended;
  }

  get currentTime(): number {
    const ctx = audioContext();
    if (this._playing && ctx && this._buffer) {
      const pos = this._offset + (ctx.currentTime - this._startedAt);
      const dur = this._buffer.duration;
      return this.loop && dur > 0 ? pos % dur : Math.min(pos, dur);
    }
    return this._offset;
  }

  set currentTime(seconds: number) {
    this._offset = seconds;
    this._ended = false;
    if (this._playing) {
      // Seek while playing: restart the (one-shot) source at the new spot.
      this.stopSource();
      this._playing = false;
      void this.play().catch(() => {
        /* decode failed — stays silent, same as the element path */
      });
    }
  }

  /** Like element.play(): flips `paused` immediately, resolves once running,
   *  rejects if the source can't be decoded. Autoplay blocking doesn't reject
   *  here — the context just stays suspended and the track starts on unlock. */
  play(): Promise<void> {
    this._ended = false;
    if (this._playing) return Promise.resolve();
    const ctx = audioContext();
    if (!ctx || !this._src) return Promise.reject(new Error('MusicTrack: no source/context'));
    if (ctx.state === 'suspended') void ctx.resume();
    this._playing = true;
    const seq = ++this._playSeq;
    return loadBuffer(this._src).then((loaded) => {
      if (seq !== this._playSeq) return; // paused or re-pointed mid-decode
      if (!loaded) {
        this._playing = false;
        throw new Error('MusicTrack: decode failed');
      }
      const { buffer, head } = loaded;
      this._buffer = buffer;
      if (!this._gain) {
        this._gain = ctx.createGain();
        this._gain.connect(ctx.destination);
      }
      this._gain.gain.value = this._volume;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = this.loop;
      if (this.loop && head > 0) {
        // Loop the audible span only — wrapping to 0 would replay the silent
        // head as a hole in the middle of the music.
        source.loopStart = head;
        source.loopEnd = buffer.duration;
      }
      let offset = buffer.duration > 0 ? this._offset % buffer.duration : 0;
      if (offset < head) offset = head; // never start inside the silent head
      source.onended = () => {
        // Manual stops detach first (stopSource), so this is a natural end.
        if (this._source !== source) return;
        this._source = null;
        this._playing = false;
        this._offset = 0;
        this._ended = true;
        this.onended?.();
      };
      source.connect(this._gain);
      source.start(0, offset);
      this._source = source;
      this._startedAt = ctx.currentTime;
      this._offset = offset;
    });
  }

  pause(): void {
    this._playSeq += 1; // abandon any play() still decoding
    if (!this._playing) return;
    const ctx = audioContext();
    if (this._source && ctx && this._buffer) {
      const dur = this._buffer.duration;
      let pos = this._offset + (ctx.currentTime - this._startedAt);
      if (this.loop && dur > 0) pos %= dur;
      this._offset = Math.min(pos, dur);
    }
    this.stopSource();
    this._playing = false;
  }

  private stopSource(): void {
    const source = this._source;
    if (!source) return;
    this._source = null; // detach BEFORE stop so onended sees a manual stop
    source.onended = null;
    try {
      source.stop();
    } catch {
      /* never started — nothing to stop */
    }
    source.disconnect();
  }
}
