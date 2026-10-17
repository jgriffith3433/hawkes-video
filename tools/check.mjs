// Checks every production (CI runs this): the files parse, shots have what they need, the edit names real shots, and,
// where Hawkes Assets is next to this repo, every shot turns into a recipe (the cast and their animations exist).
//
//   node tools/check.mjs [production]

import fs from 'node:fs';
import path from 'node:path';
import { listProductions, loadProduction, shotRecipe, ASSETS, CONTROLS } from './lib.mjs';

const problems = [];
const haveLibrary = fs.existsSync(path.join(ASSETS, 'characters'));
const ids = process.argv[2] ? [process.argv[2]] : listProductions();
let shots = 0;

for (const id of ids) {
  let p;
  try {
    p = loadProduction(id);
  } catch (e) {
    problems.push(`${id}: ${e.message}`);
    continue;
  }
  const at = (f) => `productions/${id}/${f}`;
  if (p.id !== id) problems.push(`${at('production.json')}: id is ${p.id}, the folder is ${id}`);
  if (!p.title) problems.push(`${at('production.json')}: no title`);
  if (!p.project) problems.push(`${at('production.json')}: no project (the Hawkes Gen project, for presets and costs)`);
  const ids = new Set();
  for (const s of p.shots) {
    shots++;
    const sid = s.id ?? path.basename(s.file, '.json');
    if (ids.has(sid)) problems.push(`${at(s.file)}: shot id ${sid} is used twice`);
    ids.add(sid);
    if (!s.shot && !s.set) problems.push(`${at(s.file)}: a shot needs a shot (the Blender scene) or a set`);
    if (s.seconds !== undefined && !(s.seconds > 0 && s.seconds <= 20)) problems.push(`${at(s.file)}: seconds is 0 to 20`);
    if (s.control && !CONTROLS.includes(s.control)) problems.push(`${at(s.file)}: control is ${CONTROLS.join(', ')}`);
    if (!s.motion) problems.push(`${at(s.file)}: no motion (what happens and what it sounds like, for video.control)`);
    for (const c of s.shot?.characters ?? []) {
      if (!c.cast) problems.push(`${at(s.file)}: each character names its cast role (production.json "cast")`);
      else if (!(c.cast in (p.cast ?? {}))) problems.push(`${at(s.file)}: cast ${c.cast} isn't in production.json "cast"`);
    }
    if (haveLibrary) {
      try {
        shotRecipe(p, s);
      } catch (e) {
        if (!/isn't here: run/.test(e.message)) problems.push(`${at(s.file)}: ${e.message}`);
      }
    }
  }
  const editFile = path.join(p.dir, 'edit.json');
  if (fs.existsSync(editFile)) {
    const edit = JSON.parse(fs.readFileSync(editFile, 'utf8'));
    for (const c of edit.cuts ?? []) if (!ids.has(c.shot)) problems.push(`${at('edit.json')}: no shot ${c.shot}`);
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`ok: ${ids.length} production(s), ${shots} shot(s)${haveLibrary ? '' : ' (Hawkes Assets not here: cast not checked)'}`);
