# Hawkes Video

Hawkes videos as data: each production is a folder of shots (a Blender scene, a look, a motion) and an edit. Hawkes Gen
makes each shot from the shared cast in [Hawkes Assets](https://github.com/jgriffith3433/hawkes-assets): Blender
renders it, Claude picks the best of three repaints of its first frame, and LTX makes the shot in that look, with sound.

```bash
node tools/check.mjs
node tools/make.mjs ph-tower-test --dry   # recipes and price
node tools/make.mjs ph-tower-test         # make what changed
```

The format and the rules: [`AGENTS.md`](AGENTS.md).
