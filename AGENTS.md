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
node tools/cut.mjs ph-tower-test --dry       # the music and lines to make (and Gen's price), and the cut's timeline
node tools/cut.mjs ph-tower-test             # make the music and lines, compose the cut -> out/cut.mp4
npm test                                     # the cut plan and the checks (offline)
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
  video.lock.json      what made each shot (make.mjs) and the cut (cut.mjs, under "cut")
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

## The cut

`tools/cut.mjs <production>` puts the made shots together into `out/cut.mp4`, plus `out/cut.vtt` when there are
captions and `out/poster.png`. It reads `edit.json` and `audio.json`. It takes each shot's asset from
`video.lock.json`, so run `make.mjs` first. It makes each music cue with `audio.music` (GPU, cents) and each voice line
with `audio.voice` (ElevenLabs). Then it runs Hawkes Gen's `video.compose` (ffmpeg, free) and downloads the result.
- Everything is submitted with `reuse`.
- The lock keeps the music and line assets under `"cut"`. An unchanged cue or line isn't asked for again, and an
  unchanged cut is skipped.
- `--dry` prints the work and its price. Ask J before making music on a stopped server.
- `tools/cutplan.mjs` turns the two files into the work and the timeline, and `check.mjs` validates both with it.
  The timeline format is in `hawkesgen/docs/blender.md` ("The cut: video.compose").

**`edit.json`:**

| Field | What |
|---|---|
| `cuts[]` | The cut in order (default: every shot). `shot` (a shot id; a shot can come back), `in`, `out` (seconds in the shot) |
| `cuts[].transition` | How this cut goes **into the next**: `cut` (default), `crossfade`, `dissolve`, `fadeblack`, `fadewhite`, `wipeleft`, `wiperight`, `wipeup`, `wipedown`, `slideleft`, `slideright`, `circleopen`, `circleclose`. `seconds` is its length (0.5). The two shots overlap by that much |
| `cuts[].sound`, `volume` | Keep the shot's own LTX sound (default `audio.json` `keepShotSound`) and its level. `dialogue: true` if someone speaks in it, so the music dips under it |
| `captions[]` | `text`, `start`, `end` (or `seconds`), relative to `shot` if given, else on the cut |
| `captionMode` | `vtt` (default: a separate file the player shows), `burn` (in the picture) or `both` |
| `fadeIn`, `fadeOut` | From and to black, picture and sound |
| `format` | Override the production's `{ width, height, fps }` for this cut |
| `audio` | The audio file (`audio.json`), or the audio itself |

**`audio.json`:**

| Field | What |
|---|---|
| `music` | A cue, or a list of them. `prompt` (made with `audio.music`; `lyrics`, `bpm`, `key`, `seed`, `seconds`, which defaults to the cut's length), or `asset` (`asset:<id>` already in Gen's library) |
| `music.start`, `shot` | When it starts: on the cut, or into `shot` |
| `music.volume`, `fadeIn`, `fadeOut`, `loop`, `in` | Defaults: volume 0.3, fade in 0, fade out 2 |
| `music.duck` | Dips under dialogue when there is any: `true` (default; dips to `duckTo`, 0.3), `"sidechain"` (follows the voice), or `false` |
| `voices` | Roles to ElevenLabs voice ids: `{ "hero": "..." }` (`GET /v1/providers/elevenlabs/voices` in Gen) |
| `lines[]` | `text` (`eleven_v4` takes tags like `[whispers]`), `voice` (a role or a voice id), `shot` and `at` (seconds into it), or `start` on the cut. `volume`, `model`, `settings`, or `asset` instead of making it |
| `lines[].caption` | Each line is captioned while it plays (its text without tags). `false` for none, or the text to show |
| `voiceModel` | The default `audio.voice` model |
| `keepShotSound`, `shotVolume` | Keep every shot's own sound (default true), and its level |
| `duck` | The default for every music cue |

## Rules

- Raw footage and finished videos never go in git (`.gitignore`). The shots live in Gen's library; the lock points at
  them.
- A new character goes into Hawkes Assets first (`tools/add.mjs character ...` there), then into `cast` here.
- Keep shots short and one idea each. Long takes drift; cuts are cheap.
