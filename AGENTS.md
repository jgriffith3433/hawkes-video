# Hawkes Video — agent guide

Hawkes videos as data: trailers, cutscenes, episodes, music videos. Each production is a folder of JSON that says
what every shot is. Hawkes Gen makes it from the shared cast in **Hawkes Assets** (`../hawkes-assets`):
1. Blender renders the shot.
2. Claude picks the best of three repaints of its first frame in the production's look.
3. `video.control` makes the shot in that look, with sound.

Owner: **J**. `CLAUDE.md` imports this file; edit this one.

## Use

```bash
node tools/check.mjs                         # every production valid; the cast exists (with hawkes-assets next to it)
node tools/make.mjs ph-tower-test --dry      # each shot's recipe, and Gen's price for what's not made yet
node tools/make.mjs ph-tower-test            # make the shots that changed (GPU: ask J first)
node tools/make.mjs ph-tower-test 02         # just the shots whose id contains "02"
```

**Making shots:**
- `make.mjs` needs `hawkes-assets` pulled (`node tools/sync.mjs pull` there) and finds Hawkes Gen like every
  project (`HAWKESGEN_URL` / `~/.hawkes/client.json`).
- A shot whose recipe and files haven't changed since `video.lock.json` is skipped, and Gen hands back any recipe its
  library already has. Editing one shot only pays for that shot.
- Finished shots download to `productions/<id>/out/` (not committed). The lock keeps their asset ids. **Commit
  `video.lock.json` after a make.**

**Costs:** run `--dry` first and put the price in the question to J. On a running server a 5 s shot is about $0.60
of GPU. That's an estimate until the first live run; the docs are `hawkesgen/docs/blender.md`.

## A production

```
productions/<id>/
  production.json
  shots/NN-name.json   one per shot, made in name order
  edit.json            the cut: shot order, transitions, captions
  audio.json           music, voice lines, whether to keep each shot's own sound
  video.lock.json      what made each shot (written by make.mjs)
  out/                 the finished shots (not committed)
```

**`production.json`:**

| Field | What |
|---|---|
| `id`, `title` | |
| `project` | The Hawkes Gen project: presets and costs are counted there |
| `format` | `{ width, height, fps }`. 1280 x 704 at 24 is LTX's size; 704 x 1280 for vertical |
| `look` | The art direction every shot is painted in. Take it from the project's preset (`hawkesgen/presets/<project>.json`); don't invent a look a project hasn't chosen |
| `cast` | Roles to Hawkes Assets character ids: `{ "hero": "ph-ch33-hero" }` |
| `canon` | Facts the pick must respect (optional) |
| `candidates` | How many first-frame looks Claude chooses between (3) |

**A shot** (`shots/*.json`):

| Field | What |
|---|---|
| `id` | Defaults to the file name |
| `seconds` | Up to 20; 4 to 6 works best |
| `shot` | The Blender scene in `blender.render`'s shot format (`hawkesgen/docs/blender.md`), except characters name a `cast` role instead of a file |
| `shot.characters[].animation` | A clip in the character's model (e.g. `Walk`), or a Hawkes Assets clip for its rig (`animations/<rig>/<id>.json`, e.g. `walking`) |
| `shot.background.sky` | A Hawkes Assets sky id |
| `set` | A Hawkes Assets set (a whole `.blend` location) instead of a ground |
| `look` | What this frame looks like: place, light, wardrobe. Added to the production's look for the first-frame repaint |
| `motion` | What happens and what it sounds like, for `video.control`. Describe the motion, not the picture; dialogue in quotes |
| `control` | Which Blender pass the video follows: `depth` (layout and camera), `pose` (bodies only, the rest free) or `edges` (the most detail) |
| `render`, `video` | Extra params for `blender.render` and `video.control` |
| `candidates`, `pick` | Override the production's |

**`edit.json`** is `{ cuts: [{ shot, transition }], audio, captions }`. **`audio.json`** is `{ music, lines,
keepShotSound }`. Assembling the cut from these needs Hawkes Gen's `video.compose`, which isn't built yet.
`check.mjs` already validates both files.

## Rules

- Raw footage and finished videos never go in git (`.gitignore`). The shots live in Gen's library; the lock points at
  them.
- A new character goes into Hawkes Assets first (`tools/add.mjs character ...` there), then into `cast` here.
- Keep shots short and one idea each. Long takes drift; cuts are cheap.
