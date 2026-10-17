// Productions as data: reading them, finding the cast in Hawkes Assets, and turning a shot into one Hawkes Gen recipe.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The 3D library (github.com/jgriffith3433/hawkes-assets), next to this repo unless HAWKES_ASSETS says. */
export const ASSETS = path.resolve(process.env.HAWKES_ASSETS ?? path.join(ROOT, '..', 'hawkes-assets'));
export const CONTROLS = ['depth', 'pose', 'edges'];

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

export function loadProduction(id) {
  const dir = path.join(ROOT, 'productions', id);
  const f = path.join(dir, 'production.json');
  if (!fs.existsSync(f)) throw new Error(`No production ${id} (productions/${id}/production.json)`);
  const p = readJson(f);
  const shotsDir = path.join(dir, 'shots');
  const shots = fs.existsSync(shotsDir)
    ? fs.readdirSync(shotsDir).filter((x) => x.endsWith('.json')).sort().map((x) => ({ file: `shots/${x}`, ...readJson(path.join(shotsDir, x)) }))
    : [];
  return { dir, ...p, shots };
}

export function listProductions() {
  const d = path.join(ROOT, 'productions');
  return fs.existsSync(d) ? fs.readdirSync(d).filter((x) => fs.existsSync(path.join(d, x, 'production.json'))) : [];
}

/** A character from the library: its json and the paths of its files. */
export function character(id) {
  const dir = path.join(ASSETS, 'characters', id);
  const f = path.join(dir, 'character.json');
  if (!fs.existsSync(f)) throw new Error(`Hawkes Assets has no character ${id} (${ASSETS}/characters/${id}/character.json)`);
  const c = readJson(f);
  return { ...c, modelPath: path.join(dir, c.model), referencePath: c.reference ? path.join(dir, c.reference) : null };
}

/** A library animation for a rig family, or null. */
export function animation(rig, id) {
  const f = path.join(ASSETS, 'animations', rig ?? 'custom', `${id}.json`);
  if (!fs.existsSync(f)) return null;
  const a = readJson(f);
  return { ...a, path: path.join(path.dirname(f), a.file) };
}

/**
 * One shot as an asset.make recipe for Hawkes Gen:
 *   1. blender.render the shot (the cast and their animations from Hawkes Assets)
 *   2. image.edit its first frame into the production's look (candidates; Claude picks against the reference sheets)
 *   3. video.control: the whole shot in that look, following the chosen control video, with sound
 * Returns { params, inputs } for gen.submit('asset.make', ...). Files are local paths; the client uploads them.
 */
export function shotRecipe(prod, shot) {
  const files = [];
  const fileIndex = (p) => {
    if (!fs.existsSync(p)) throw new Error(`${p} isn't here: run "node tools/sync.mjs pull" in hawkes-assets`);
    let i = files.indexOf(p);
    if (i < 0) i = files.push(p) - 1;
    return i;
  };
  const cast = prod.cast ?? {};
  const refs = [];
  const s = JSON.parse(JSON.stringify(shot.shot ?? {}));
  s.characters = (s.characters ?? []).map((c) => {
    const { cast: role, ...rest } = c;
    const libId = cast[role] ?? role;
    const ch = character(libId);
    const out = { height: ch.height ?? undefined, ...rest, file: fileIndex(ch.modelPath) };
    if (c.animation && !ch.animations.includes(c.animation)) {
      // Not a clip inside the model: a library clip for the character's rig.
      const a = animation(ch.rig, c.animation);
      if (!a) throw new Error(`${shot.file}: ${libId} has no animation ${c.animation} (in its file: ${ch.animations.join(', ') || 'none'}; or animations/${ch.rig}/${c.animation}.json in Hawkes Assets)`);
      delete out.animation;
      out.animationFile = fileIndex(a.path);
    }
    if (ch.referencePath && !refs.includes(ch.referencePath)) refs.push(ch.referencePath);
    return out;
  });
  if (s.background?.sky) {
    const sky = JSON.parse(fs.readFileSync(path.join(ASSETS, 'skies', `${s.background.sky}.json`), 'utf8'));
    const { sky: _, ...bg } = s.background;
    s.background = { ...bg, file: fileIndex(path.join(ASSETS, 'skies', sky.file)) };
  }
  const fmt = { width: 1280, height: 704, fps: 24, ...(prod.format ?? {}) };
  const control = shot.control ?? 'depth';
  if (!CONTROLS.includes(control)) throw new Error(`${shot.file}: control is ${CONTROLS.join(', ')}`);
  const renderInputs = { files: files.map((_, i) => `$input:${i}`) };
  let sceneIndex = null;
  if (shot.set) {
    const setDir = path.join(ASSETS, 'sets', shot.set);
    const set = readJson(path.join(setDir, 'set.json'));
    sceneIndex = fileIndex(path.join(setDir, set.file));
    renderInputs.scene = `$input:${sceneIndex}`;
    renderInputs.files = renderInputs.files.filter((x) => x !== `$input:${sceneIndex}`);
  }
  const refInputs = refs.map((r) => `$input:${fileIndex(r)}`).slice(0, 2);
  const steps = [
    {
      tool: 'blender.render',
      inputs: renderInputs,
      params: { shot: s, seconds: shot.seconds ?? 5, fps: fmt.fps, width: fmt.width, height: fmt.height, passes: ['beauty', 'depth', 'pose', 'edges'], ...(shot.render ?? {}) },
      save: 'render',
    },
    {
      tool: 'image.edit',
      inputs: { images: ['$step1:first frame', ...refInputs] },
      params: {
        prompt: `Repaint this 3D render as a finished frame: ${prod.look ?? ''} ${shot.look ?? ''}${refInputs.length ? ` Images 2${refInputs.length > 1 ? ' and 3' : ''} are the characters' reference sheets: keep them on-model.` : ''} Keep the composition, the camera and the poses exactly.`.replace(/\s+/g, ' ').trim(),
        width: fmt.width, height: fmt.height,
      },
      save: 'look',
    },
    {
      tool: 'video.control',
      inputs: { control: `$step1:${control}`, image: '$prev' },
      params: { prompt: shot.motion ?? shot.look ?? '', width: fmt.width, height: fmt.height, fps: fmt.fps, seconds: shot.seconds ?? 5, ...(shot.video ?? {}) },
      save: 'video',
    },
  ];
  const params = {
    steps, pickAt: 2, candidates: shot.candidates ?? prod.candidates ?? 3,
    pick: shot.pick ?? 'keeps the render\'s composition and poses; on-model with the reference sheets; matches the look',
    ...(prod.canon ? { canon: prod.canon } : {}),
    ...(refs.length ? { refs: refs.map((r) => fileIndex(r)) } : {}),
  };
  return { params, inputs: files.length ? { files } : {} };
}

/** A fingerprint of a shot's recipe and its input files (what the lock compares). */
export function recipeHash(recipe) {
  const h = crypto.createHash('sha256').update(JSON.stringify(recipe.params));
  for (const f of recipe.inputs.files ?? []) h.update(fs.readFileSync(f));
  return h.digest('hex').slice(0, 16);
}
