// The cut plan: edit.json + audio.json -> the music and voice work and video.compose's timeline, and the checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutPlan, cutProblems, lineCaption } from '../tools/cutplan.mjs';

const prod = {
  dir: '.', format: { width: 1280, height: 704, fps: 24 },
  shots: [{ file: 'shots/01-walk.json', seconds: 5 }, { file: 'shots/02-look-up.json', seconds: 4 }],
};

test('cutPlan: transitions, the music length, voice lines with captions, ducking', () => {
  const edit = {
    cuts: [{ shot: '01-walk', transition: 'crossfade', seconds: 0.5 }, { shot: '02-look-up', out: 3.5 }, { shot: '01-walk', in: 3, sound: false }],
    captions: [{ shot: '02-look-up', start: 0.2, end: 1, text: 'Hawkes Tower' }], fadeOut: 1, captionMode: 'both',
  };
  const audio = {
    music: { prompt: 'tense synth', volume: 0.2 },
    voices: { hero: 'abcdefghijklmnopqrst' },
    lines: [{ shot: '02-look-up', at: 0.5, voice: 'hero', text: '[whispers] Who is there?' }, { start: 7, voice: 'abcdefghijklmnopqrst', text: 'Nobody.', caption: false }],
    keepShotSound: true,
  };
  assert.deepEqual(cutProblems(prod, edit, audio), []);
  const p = cutPlan(prod, edit, audio);
  assert.deepEqual(p.order, ['01-walk', '02-look-up']);
  assert.equal(p.seconds, 5 - 0.5 + 3.5 + 2);
  assert.deepEqual(p.music[0].job, { tool: 'audio.music', params: { prompt: 'tense synth', seconds: 11 } });
  assert.deepEqual(p.lines[0].job.params, { text: '[whispers] Who is there?', voice: 'abcdefghijklmnopqrst' });
  assert.throws(() => p.timeline({}), /music isn't made yet/);
  const t = p.timeline({ music: 'm1', line1: 'v1', line2: 'asset:v2' });
  assert.deepEqual(t.audio, ['asset:m1', 'asset:v1', 'asset:v2']);
  const tl = t.params.timeline;
  assert.deepEqual(tl.clips, [
    { clip: 0, transition: 'crossfade', seconds: 0.5, sound: true },
    { clip: 1, out: 3.5, sound: true },
    { clip: 0, in: 3, sound: false },
  ]);
  assert.deepEqual(tl.audio[0], { audio: 0, start: 0, volume: 0.2, fadeIn: 0, fadeOut: 2, loop: false, duck: true });
  assert.deepEqual(tl.audio[1], { audio: 1, clip: 1, start: 0.5, dialogue: true });
  assert.deepEqual(tl.audio[2], { audio: 2, start: 7, dialogue: true });
  assert.deepEqual(tl.captions, [{ text: 'Hawkes Tower', start: 0.2, end: 1, clip: 1 }, { text: 'Who is there?', track: 1 }]);
  assert.deepEqual([t.params.width, t.params.fps, t.params.captions, tl.fadeOut], [1280, 24, 'both', 1]);
});

test('cutPlan: no lines, no ducking; an existing music asset is used as it is', () => {
  const p = cutPlan(prod, { cuts: [{ shot: '01-walk' }] }, { music: { asset: 'asset:abc', loop: true } });
  assert.equal(p.music[0].job, null);
  const t = p.timeline();
  assert.deepEqual(t.audio, ['asset:abc']);
  assert.equal(t.params.timeline.audio[0].duck, undefined);
});

test('cutProblems: says what is wrong', () => {
  const bad = cutProblems(prod, {
    cuts: [{ shot: '01-walk', transition: 'spin' }, { shot: 'nope' }, { shot: '02-look-up', out: 9 }, { shot: '01-walk', transition: 'crossfade', seconds: 4.5 }, { shot: '02-look-up' }],
    captions: [{ start: 1 }], captionMode: 'big',
  }, { music: { volume: 'loud' }, lines: [{ text: 'hi', voice: 'villain', shot: '03' }] });
  const all = bad.join('\n');
  for (const re of [/transition is cut, crossfade/, /no shot nope/, /past the end of the shot/, /longer than a clip it joins/, /captions\[0\]: no text/, /captionMode is/, /a prompt \(made with audio.music\)/, /volume is a number/, /voice villain isn't in "voices"/, /shot 03 isn't in the cut/]) {
    assert.match(all, re);
  }
});

test('lineCaption: delivery tags come out', () => {
  assert.equal(lineCaption('[sighs] Fine. [laughs] Fine!'), 'Fine. Fine!');
});
