// Assembles a production's finished cut through Hawkes Gen: edit.json (shot order, trims, transitions, captions) and
// audio.json (music, voice lines, each shot's own sound) over the shots make.mjs made (their asset ids are in
// video.lock.json). It makes any music cue with audio.music (GPU) and voice lines with audio.voice (ElevenLabs), then
// runs video.compose (free, ffmpeg) and downloads the cut.
//
//   node tools/cut.mjs <production>            make what's missing, compose, download out/cut.mp4 (+ cut.vtt, poster.png)
//   node tools/cut.mjs <production> --dry      print the audio to make (and Gen's price) and the timeline; make nothing
//   node tools/cut.mjs <production> --force    ask Gen again even where the lock is current
//
// Everything is submitted with reuse, so a recipe Gen's library already has comes back from it. The lock's "cut" entry
// keeps the compose job, its outputs and the music and voice assets. Commit video.lock.json after a cut.

import fs from 'node:fs';
import path from 'node:path';
import { HawkesGen } from './hawkesgen.mjs';
import { loadProduction } from './lib.mjs';
import { loadCut, cutProblems, cutPlan, workHash } from './cutplan.mjs';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const [id] = args.filter((a) => !a.startsWith('--'));
if (!id) {
  console.error('usage: node tools/cut.mjs <production> [--dry] [--force]');
  process.exit(2);
}

const prod = loadProduction(id);
const { edit, audio } = loadCut(prod);
const problems = cutProblems(prod, edit, audio);
if (problems.length) {
  console.error(problems.map((p) => `productions/${id}/${p}`).join('\n'));
  process.exit(1);
}
const lockFile = path.join(prod.dir, 'video.lock.json');
const lock = fs.existsSync(lockFile) ? JSON.parse(fs.readFileSync(lockFile, 'utf8')) : {};
const saveLock = () => fs.writeFileSync(lockFile, JSON.stringify(lock, null, 1) + '\n');
const plan = cutPlan(prod, edit, audio);
const dry = flags.has('--dry');
const force = flags.has('--force');

const missing = plan.order.filter((s) => !lock[s]?.outputs?.video);
if (missing.length && !dry) {
  console.error(`Not made yet: ${missing.join(', ')}. Run: node tools/make.mjs ${id}`);
  process.exit(1);
}

const gen = new HawkesGen({ project: prod.project });
const made = {};
const todo = [];
const prevAudio = lock.cut?.audio ?? {};
for (const x of [...plan.music, ...plan.lines]) {
  if (!x.job) continue;
  const hash = workHash(x.job);
  if (!force && prevAudio[x.name]?.hash === hash) made[x.name] = prevAudio[x.name].asset;
  else todo.push({ ...x, hash });
}
console.log(`${prod.title}: ${plan.cuts.length} cut(s), about ${plan.seconds.toFixed(1)} s; ${plan.music.length} music cue(s), ${plan.lines.length} line(s)`);

if (dry) {
  if (missing.length) console.log(`Shots not made yet: ${missing.join(', ')} (node tools/make.mjs ${id})`);
  for (const x of todo) console.log(`\n# ${x.name}: ${x.job.tool} (${x.hash})\n${JSON.stringify(x.job.params, null, 1)}`);
  const placeholders = Object.fromEntries([...plan.music, ...plan.lines].map((x) => [x.name, made[x.name] ?? `<${x.name}>`]));
  const tl = plan.timeline(placeholders);
  console.log(`\n# video.compose (clips: ${plan.order.join(', ')})\n${JSON.stringify(tl.params, null, 1)}`);
  if (todo.length) {
    try {
      const e = await gen.estimate(todo.map((x) => ({ tool: x.job.tool, params: x.job.params, label: x.name })));
      console.log(`\nTo make: ${todo.map((x) => x.name).join(', ')}: about $${e.cost.total} ($${e.cost.withIdleTail} if a GPU server then idles). ${e.note ?? ''}`);
    } catch (err) {
      console.log(`\nGen couldn't price it: ${err.message}`);
    }
  } else console.log('\nThe music and lines are made; composing is free.');
  process.exit(0);
}

const progress = (j) => process.stdout.write(`\r  ${String(j.detail ?? '').slice(0, 110).padEnd(110)}`);
lock.cut = { ...(lock.cut ?? {}), audio: { ...prevAudio } };
for (const x of todo) {
  console.log(`${x.name}: ${x.job.tool} (${x.hash})`);
  const job = await gen.submit(x.job.tool, {
    params: x.job.params, reuse: true, labels: { production: prod.id, cut: x.name }, key: `video:${prod.id}:${x.name}:${x.hash}`,
  });
  const done = job.status === 'done' ? job : await gen.wait(job.id, { onUpdate: progress, timeoutMs: 2 * 3600_000 });
  process.stdout.write('\n');
  const asset = done.outputs?.[0]?.asset;
  if (!asset) throw new Error(`${x.name}: ${x.job.tool} made nothing (job ${done.id})`);
  made[x.name] = asset;
  lock.cut.audio[x.name] = { hash: x.hash, job: done.id, asset };
  saveLock();
}
// Cues and lines that are gone from audio.json leave the lock too.
const names = new Set([...plan.music, ...plan.lines].filter((x) => x.job).map((x) => x.name));
for (const k of Object.keys(lock.cut.audio)) if (!names.has(k)) delete lock.cut.audio[k];

const tl = plan.timeline(made);
const inputs = { clips: plan.order.map((s) => `asset:${lock[s].outputs.video}`), audio: tl.audio };
const recipe = workHash({ params: tl.params, inputs });
const dest = path.join(prod.dir, 'out', 'cut.mp4');
if (!force && lock.cut.recipe === recipe && fs.existsSync(dest)) {
  console.log(`cut: current (${path.relative(process.cwd(), dest)})`);
  saveLock();
  process.exit(0);
}
console.log(`cut: video.compose (${recipe})`);
const job = await gen.submit('video.compose', {
  params: tl.params, inputs, reuse: true, labels: { production: prod.id, cut: 'cut' }, key: `video:${prod.id}:cut:${recipe}`,
});
const done = job.status === 'done' ? job : await gen.wait(job.id, { onUpdate: progress, timeoutMs: 3600_000 });
process.stdout.write('\n');
const outputs = Object.fromEntries((done.outputs ?? []).map((o) => [o.title, o.asset]));
if (!outputs.cut) throw new Error(`video.compose made no cut (job ${done.id})`);
lock.cut = { ...lock.cut, recipe, job: done.id, made: new Date().toISOString(), outputs, ...(done.result?.duration ? { duration: done.result.duration } : {}) };
saveLock();
const files = { cut: 'cut.mp4', captions: 'cut.vtt', poster: 'poster.png' };
for (const [title, name] of Object.entries(files)) {
  if (!outputs[title]) continue;
  const f = path.join(prod.dir, 'out', name);
  await gen.download(outputs[title], f);
  console.log(`  -> ${path.relative(process.cwd(), f)}`);
}
console.log(`Done${done.result?.duration ? `: ${done.result.duration} s at ${done.result.width} x ${done.result.height}, ${done.result.fps} fps` : ''}. Commit video.lock.json.`);
