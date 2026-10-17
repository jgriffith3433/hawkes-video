// The cut: a production's edit.json and audio.json as Hawkes Gen work. The music cues (audio.music) and voice lines
// (audio.voice) to make, then video.compose's timeline over the made shots. check.mjs uses cutProblems; cut.mjs the rest.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const shotId = (s) => s.id ?? path.basename(s.file, '.json');
/** How a cut goes into the next one (video.compose's transitions). */
export const TRANSITIONS = ['cut', 'crossfade', 'dissolve', 'fadeblack', 'fadewhite', 'wipeleft', 'wiperight', 'wipeup', 'wipedown', 'slideleft', 'slideright', 'circleopen', 'circleclose'];
export const CAPTION_MODES = ['vtt', 'burn', 'both'];
export const DUCKS = [true, false, 'envelope', 'sidechain'];

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const asList = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** A production's edit.json and audio.json (edit.audio names the audio file, or holds it). No edit.json: every shot, cut together. */
export function loadCut(prod) {
  const read = (f) => (fs.existsSync(path.join(prod.dir, f)) ? readJson(path.join(prod.dir, f)) : null);
  const edit = read('edit.json') ?? { cuts: prod.shots.map((s) => ({ shot: shotId(s) })) };
  const audio = edit.audio && typeof edit.audio === 'object' ? edit.audio : read(typeof edit.audio === 'string' ? edit.audio : 'audio.json') ?? {};
  return { edit, audio };
}

/** A voice line's caption: its words without delivery tags like [sighs]. */
export const lineCaption = (text) => String(text).replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();

/** What's wrong with a production's edit.json and audio.json. */
export function cutProblems(prod, edit, audio) {
  const out = [];
  const shots = new Map(prod.shots.map((s) => [shotId(s), s]));
  const cuts = edit.cuts ?? [];
  if (!Array.isArray(cuts)) return ['edit.json: cuts is a list'];
  const num = (where, o, k, { min = 0, max = Infinity } = {}) => {
    if (o[k] !== undefined && !(isNum(o[k]) && o[k] >= min && o[k] <= max)) out.push(`${where}: ${k} is a number from ${min}${max < Infinity ? ` to ${max}` : ''}`);
  };
  const clipLength = (c) => (c.out ?? shots.get(c.shot)?.seconds ?? 5) - (c.in ?? 0);

  cuts.forEach((c, i) => {
    const at = `edit.json cuts[${i}]`;
    const s = shots.get(c.shot);
    if (!s) return out.push(`${at}: no shot ${c.shot}`);
    for (const k of ['in', 'out']) num(at, c, k);
    num(at, c, 'seconds', { min: 0.04, max: 10 });
    num(at, c, 'volume', { max: 4 });
    const len = s.seconds ?? 5;
    if ((c.out ?? len) <= (c.in ?? 0)) out.push(`${at}: out (${c.out ?? len}) is before in (${c.in ?? 0})`);
    if ((c.out ?? 0) > len) out.push(`${at}: out (${c.out}) is past the end of the shot (${len} s)`);
    if (c.transition !== undefined && !TRANSITIONS.includes(c.transition)) out.push(`${at}: transition is ${TRANSITIONS.join(', ')} (how it goes into the next)`);
    for (const k of ['sound', 'dialogue']) if (c[k] !== undefined && typeof c[k] !== 'boolean') out.push(`${at}: ${k} is true or false`);
    const x = c.transition && c.transition !== 'cut' ? c.seconds ?? 0.5 : 0;
    const next = cuts[i + 1];
    if (x && next && shots.get(next.shot) && x >= Math.min(clipLength(c), clipLength(next))) out.push(`${at}: the ${x} s ${c.transition} is longer than a clip it joins`);
  });
  num('edit.json', edit, 'fadeIn', { max: 10 });
  num('edit.json', edit, 'fadeOut', { max: 10 });
  if (edit.captionMode !== undefined && !CAPTION_MODES.includes(edit.captionMode)) out.push(`edit.json: captionMode is ${CAPTION_MODES.join(', ')}`);
  if (edit.audio !== undefined && !['string', 'object'].includes(typeof edit.audio)) out.push('edit.json: audio is a file name (audio.json) or the audio itself');
  if (typeof edit.audio === 'string' && !fs.existsSync(path.join(prod.dir, edit.audio))) out.push(`edit.json: audio file ${edit.audio} isn't there`);
  if (edit.format !== undefined) for (const k of ['width', 'height', 'fps']) num('edit.json format', edit.format, k, { min: 8, max: 3840 });

  const anchor = (where, o) => {
    if (o.shot !== undefined && !cuts.some((c) => c.shot === o.shot)) out.push(`${where}: shot ${o.shot} isn't in the cut`);
  };
  if (edit.captions !== undefined && !Array.isArray(edit.captions)) out.push('edit.json: captions is a list');
  asList(edit.captions).forEach((c0, i) => {
    const c = c0 ?? {};
    const at = `edit.json captions[${i}]`;
    if (!c.text) out.push(`${at}: no text`);
    anchor(at, c);
    for (const k of ['start', 'end']) num(at, c, k);
    num(at, c, 'seconds', { min: 0.1 });
    if (c.end !== undefined && c.end <= (c.start ?? 0)) out.push(`${at}: end is before start`);
  });

  asList(audio.music).forEach((m, i) => {
    const at = `audio.json music${Array.isArray(audio.music) ? `[${i}]` : ''}`;
    if (!m.prompt && !m.asset) out.push(`${at}: a prompt (made with audio.music) or an asset (asset:<id> from Gen's library)`);
    if (m.asset && !/^asset:\S+$/.test(m.asset)) out.push(`${at}: asset is asset:<id>`);
    anchor(at, m);
    for (const k of ['start', 'in', 'fadeIn', 'fadeOut']) num(at, m, k);
    num(at, m, 'volume', { max: 4 });
    num(at, m, 'seconds', { min: 10, max: 240 });
    num(at, m, 'bpm', { min: 40, max: 220 });
    num(at, m, 'duckTo', { max: 1 });
    if (m.duck !== undefined && !DUCKS.includes(m.duck)) out.push(`${at}: duck is true, false or "sidechain"`);
    if (m.loop !== undefined && typeof m.loop !== 'boolean') out.push(`${at}: loop is true or false`);
  });
  const voices = audio.voices ?? {};
  if (typeof voices !== 'object' || Array.isArray(voices)) out.push('audio.json: voices is { role: ElevenLabs voice id }');
  if (audio.lines !== undefined && !Array.isArray(audio.lines)) out.push('audio.json: lines is a list');
  asList(audio.lines).forEach((l, i) => {
    const at = `audio.json lines[${i}]`;
    if (l.asset) {
      if (!/^asset:\S+$/.test(l.asset)) out.push(`${at}: asset is asset:<id>`);
    } else {
      if (!l.text) out.push(`${at}: no text (or an asset)`);
      if (!l.voice) out.push(`${at}: no voice (a role in "voices", or an ElevenLabs voice id)`);
      else if (!(l.voice in voices) && !/^[A-Za-z0-9]{16,}$/.test(l.voice)) out.push(`${at}: voice ${l.voice} isn't in "voices" and doesn't look like an ElevenLabs voice id`);
    }
    if (!l.shot && !isNum(l.start)) out.push(`${at}: a shot to say it in (with "at") or a start on the cut`);
    anchor(at, l);
    for (const k of ['at', 'start']) num(at, l, k);
    num(at, l, 'volume', { max: 4 });
    if (l.caption !== undefined && !['boolean', 'string'].includes(typeof l.caption)) out.push(`${at}: caption is true, false or the text to show`);
  });
  if (audio.keepShotSound !== undefined && typeof audio.keepShotSound !== 'boolean') out.push('audio.json: keepShotSound is true or false');
  num('audio.json', audio, 'shotVolume', { max: 4 });
  if (audio.duck !== undefined && !DUCKS.includes(audio.duck)) out.push('audio.json: duck is true, false or "sidechain"');
  return out;
}

/**
 * The cut as Hawkes Gen work: the shots it uses (in clip order), the music cues and voice lines to make (each
 * { name, spec, asset, job }), the cut's length, and timeline(made), which gives video.compose's inputs and params
 * once every cue and line has an asset. A music cue's length defaults to the cut's.
 */
export function cutPlan(prod, edit, audio) {
  const shots = new Map(prod.shots.map((s) => [shotId(s), s]));
  const cuts = edit.cuts?.length ? edit.cuts : prod.shots.map((s) => ({ shot: shotId(s) }));
  const order = [...new Set(cuts.map((c) => c.shot))];
  const clipAt = (shot) => cuts.findIndex((c) => c.shot === shot);
  const into = (c, i) => (i < cuts.length - 1 && c.transition && c.transition !== 'cut' ? c.seconds ?? 0.5 : 0);
  const seconds = cuts.reduce((t, c, i) => t + (c.out ?? shots.get(c.shot)?.seconds ?? 5) - (c.in ?? 0) - into(c, i), 0);
  const fmt = { width: 1280, height: 704, fps: 24, ...(prod.format ?? {}), ...(edit.format ?? {}) };
  const voices = audio.voices ?? {};

  const music = asList(audio.music).map((m, i) => ({
    name: `music${i ? i + 1 : ''}`, spec: m, asset: m.asset ?? null,
    job: m.asset ? null : {
      tool: 'audio.music',
      params: {
        prompt: m.prompt,
        seconds: Math.min(240, Math.max(10, Math.ceil(m.seconds ?? seconds - (m.start ?? 0) + 1))),
        ...(m.lyrics ? { lyrics: m.lyrics } : {}), ...(m.bpm ? { bpm: m.bpm } : {}), ...(m.key ? { key: m.key } : {}),
        ...(m.seed !== undefined ? { seed: m.seed } : {}),
      },
    },
  }));
  const lines = asList(audio.lines).map((l, i) => {
    const model = l.model ?? audio.voiceModel;
    return {
      name: `line${i + 1}`, spec: l, asset: l.asset ?? null,
      job: l.asset ? null : {
        tool: 'audio.voice',
        params: { text: l.text, voice: voices[l.voice] ?? l.voice, ...(model ? { model } : {}), ...(l.settings ? { settings: l.settings } : {}) },
      },
    };
  });

  function timeline(made = {}) {
    const id = (x) => String(x.asset ?? made[x.name] ?? '').replace(/^asset:/, '');
    for (const x of [...music, ...lines]) if (!id(x)) throw new Error(`${x.name} isn't made yet`);
    const hasDialogue = lines.length > 0 || cuts.some((c) => c.dialogue);
    const tracks = [
      ...music.map((m, i) => {
        const s = m.spec;
        const duck = s.duck ?? audio.duck ?? true;
        return {
          audio: i, start: s.start ?? 0, ...(s.shot ? { clip: clipAt(s.shot) } : {}), ...(s.in ? { in: s.in } : {}),
          volume: s.volume ?? 0.3, fadeIn: s.fadeIn ?? 0, fadeOut: s.fadeOut ?? 2, loop: s.loop ?? false,
          ...(hasDialogue && duck ? { duck, ...(s.duckTo !== undefined ? { duckTo: s.duckTo } : {}) } : {}),
        };
      }),
      ...lines.map((l, i) => {
        const s = l.spec;
        return {
          audio: music.length + i, ...(s.shot ? { clip: clipAt(s.shot), start: s.at ?? 0 } : { start: s.start ?? 0 }),
          ...(s.volume !== undefined ? { volume: s.volume } : {}), dialogue: true,
        };
      }),
    ];
    const captions = [
      ...asList(edit.captions).map((c) => ({
        text: c.text, start: c.start ?? 0, ...(c.end !== undefined ? { end: c.end } : {}), ...(c.seconds ? { seconds: c.seconds } : {}),
        ...(c.shot ? { clip: clipAt(c.shot) } : {}),
      })),
      // Each voice line is captioned while it plays, unless it says otherwise.
      ...lines.flatMap((l, i) => {
        const c = l.spec.caption;
        const text = typeof c === 'string' ? c : c === false || !l.spec.text ? '' : lineCaption(l.spec.text);
        return text ? [{ text, track: music.length + i }] : [];
      }),
    ];
    const keep = audio.keepShotSound ?? true;
    const clips = cuts.map((c, i) => {
      const volume = c.volume ?? audio.shotVolume;
      return {
        clip: order.indexOf(c.shot), ...(c.in ? { in: c.in } : {}), ...(c.out !== undefined ? { out: c.out } : {}),
        ...(into(c, i) ? { transition: c.transition, seconds: into(c, i) } : {}),
        sound: c.sound ?? keep, ...(volume !== undefined ? { volume } : {}), ...(c.dialogue ? { dialogue: true } : {}),
      };
    });
    return {
      audio: [...music, ...lines].map((x) => `asset:${id(x)}`),
      params: {
        timeline: { clips, audio: tracks, captions, ...(edit.fadeIn ? { fadeIn: edit.fadeIn } : {}), ...(edit.fadeOut ? { fadeOut: edit.fadeOut } : {}) },
        width: fmt.width, height: fmt.height, fps: fmt.fps, captions: edit.captionMode ?? 'vtt',
      },
    };
  }
  return { cuts, order, seconds, music, lines, timeline };
}

/** A fingerprint of a piece of work (what the lock compares before asking Gen again). */
export const workHash = (x) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
