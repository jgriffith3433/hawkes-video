// Makes a production's shots through Hawkes Gen: each shot is one asset.make recipe (tools/lib.mjs, shotRecipe). A shot
// whose recipe (and input files) hasn't changed since video.lock.json is skipped; Gen also hands back any recipe its
// library already has, so a re-run only pays for what's new.
//
//   node tools/make.mjs <production> [shot ...]      make the shots (all, or those whose id contains one of the words)
//   node tools/make.mjs <production> --dry           print each shot's recipe and Gen's price for the batch; make nothing
//   node tools/make.mjs <production> --force         make even the shots the lock says are current
//
// The finished shots download to productions/<id>/out/<shot>.mp4 (not committed: they're in Gen's library, and the
// lock has their asset ids). Hawkes Gen is found the way every project finds it (HAWKESGEN_URL / ~/.hawkes/client.json).
// GPU work costs money: run --dry first and ask J before a big batch.

import fs from 'node:fs';
import path from 'node:path';
import { HawkesGen } from './hawkesgen.mjs';
import { loadProduction, shotRecipe, recipeHash } from './lib.mjs';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const [id, ...only] = args.filter((a) => !a.startsWith('--'));
if (!id) {
  console.error('usage: node tools/make.mjs <production> [shot ...] [--dry] [--force]');
  process.exit(2);
}

const prod = loadProduction(id);
const lockFile = path.join(prod.dir, 'video.lock.json');
const lock = fs.existsSync(lockFile) ? JSON.parse(fs.readFileSync(lockFile, 'utf8')) : {};
const shotId = (s) => s.id ?? path.basename(s.file, '.json');
const shots = prod.shots.filter((s) => !only.length || only.some((w) => shotId(s).includes(w)));
const gen = new HawkesGen({ project: prod.project });

const recipes = shots.map((s) => ({ shot: s, id: shotId(s), recipe: shotRecipe(prod, s) }));

if (flags.has('--dry')) {
  for (const r of recipes) {
    console.log(`\n# ${r.id} (${recipeHash(r.recipe)}${lock[r.id]?.recipe === recipeHash(r.recipe) ? ', current' : ''})`);
    console.log(JSON.stringify({ params: r.recipe.params, inputs: r.recipe.inputs }, null, 1));
  }
  const todo = recipes.filter((r) => flags.has('--force') || lock[r.id]?.recipe !== recipeHash(r.recipe));
  if (!todo.length) {
    console.log('\nEvery shot is current.');
    process.exit(0);
  }
  try {
    const e = await gen.estimate(todo.map((r) => ({ tool: 'asset.make', params: r.recipe.params, label: r.id })));
    console.log(`\n${todo.length} shot(s) to make: about ${e.gpu.hours} GPU hours, $${e.cost.total} ($${e.cost.withIdleTail} if the servers then idle). ${e.note ?? ''}`);
  } catch (err) {
    console.log(`\nGen couldn't price it: ${err.message}`);
  }
  process.exit(0);
}

let made = 0;
for (const r of recipes) {
  const hash = recipeHash(r.recipe);
  if (!flags.has('--force') && lock[r.id]?.recipe === hash) {
    console.log(`${r.id}: current`);
    continue;
  }
  console.log(`${r.id}: making (${hash})`);
  const job = await gen.submit('asset.make', {
    params: r.recipe.params, inputs: r.recipe.inputs, reuse: true,
    labels: { production: prod.id, shot: r.id }, key: `video:${prod.id}:${r.id}:${hash}`,
  });
  const done = job.status === 'done' ? job : await gen.wait(job.id, { onUpdate: (j) => process.stdout.write(`\r  ${String(j.detail ?? '').slice(0, 110).padEnd(110)}`), timeoutMs: 6 * 3600_000 });
  process.stdout.write('\n');
  const outputs = Object.fromEntries((done.outputs ?? []).map((o) => [o.title, o.asset]));
  lock[r.id] = { recipe: hash, job: done.id, made: new Date().toISOString(), outputs };
  fs.writeFileSync(lockFile, JSON.stringify(lock, null, 1) + '\n');
  if (outputs.video) {
    const dest = path.join(prod.dir, 'out', `${r.id}.mp4`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    await gen.download(outputs.video, dest);
    console.log(`  -> ${path.relative(process.cwd(), dest)}`);
  }
  made++;
}
console.log(`${made} shot(s) made. Commit video.lock.json.`);
