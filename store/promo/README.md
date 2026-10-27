# Taily highlight film

A 32.5-second advert, 1080 × 1920 (stories, reels, shorts) and 1920 × 1080 (YouTube, X, LinkedIn),
built from the real app: every phone shot is the web build filmed frame by frame on a fictional demo
month, with the app's own clicks and sounds where they happened, over a 120 BPM track.

Nothing here is drawn to look like the app. The widget on the home-screen shot is drawn from
`widget_voice.xml` (a browser can't run a launcher), at its real sizes and colours.

## Rebuild

```bash
npx vite --mode play --port 5180                 # the Play build, in its own terminal
node store/promo/capture.mjs                     # films the app -> build/clips/ (about 6 min)
node store/promo/render.mjs 9x16                 # draws the film at 2x -> build/frames-9x16/
node store/promo/render.mjs 16x9                 # -> build/frames-16x9/
node store/promo/mix.mjs                         # music + every sound -> build/mix.wav
blender -b -P store/promo/encode.py -- store/promo/build/frames-9x16 store/promo/build/mix.wav store/promo/out/taily-highlight-9x16.mp4 1080 1920
blender -b -P store/promo/encode.py -- store/promo/build/frames-16x9 store/promo/build/mix.wav store/promo/out/taily-highlight-16x9.mp4 1920 1080
node store/promo/verify.mjs store/promo/out/taily-highlight-9x16.mp4 1,9,30.5
```

To look before rendering everything: `node store/promo/render.mjs 9x16 --stills 1.2,7.6,12.9,30.5`
writes single frames to `build/stills/`.

## The pieces

- `capture.mjs` films each clip in virtual time (`lib/virtual-time.js`): the page's clock, timers,
  animation frames and CSS animations only move when the script steps them, so every frame is exactly
  1/60 s after the last however slow the screenshot. It scripts the browser's speech recognizer with
  the words of each take, and logs every touch, every sound the app starts and where the voice panel
  sits, frame by frame.
- `film/` is the film as a page: `render(t)` draws the frame at `t` seconds, cut to the music's grid
  (first downbeat 0.035 s, a bar every 2 s), and `FILM.events` lists each sound the soundtrack adds.
- `mix.mjs` lays those sounds over the music: the app's recorded clicks, its synth pops made sample for
  sample from `src/lib/sound.ts`, and filtered-noise whooshes; mastered to -14 LUFS, peaks under -1 dBFS.
- `encode.py` is Blender's sequencer standing in for ffmpeg: it box-filters the 2x frames down and writes
  H.264 (CRF 17, a keyframe a second, 60 fps) with 256 kb/s AAC.
- `verify.mjs` reads the MP4's own boxes and pulls frames back out of it with the browser's decoder.

## Music

`music/v1.m4a`, made for this film with Higgsfield's Sonilo Music (32 s): "Upbeat, clean, modern tech-pop
instrumental for a 30-second mobile app commercial ... Steady 120 BPM in 4/4 ... One bar sparse intro,
catchy main groove, a short breakdown about two thirds in, then a clean final hit at the end. No vocals."
`music/to_wav.py` turns it into the 48 kHz WAV the mixer reads (`blender -b -P music/to_wav.py`), and
`music/analyze.mjs` found its tempo, the first downbeat and the bars the cut follows.

## Sharing

Messaging apps re-compress video. To keep it sharp in WhatsApp, send the MP4 as a document, or share a link.
