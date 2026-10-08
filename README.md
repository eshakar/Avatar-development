# Avatar Lab · Dance Studio

A browser studio that makes a 3D avatar dance **in sync with any song** and renders it to an MP4 with the mixed
audio. Built with **Three.js** (rendering), **Web Audio** (mixing + beat detection), **WebCodecs/Mediabunny** (export),
**React + Zustand + Framer Motion** (UI).

```bash
npm install
npm run dev     # http://localhost:5173
```

Works out of the box with a generated 118 BPM demo song. Drop your own song on the page to replace it.

## How the sync works

1. **Beat detection** (`src/audio/beatAnalysis.js`, in a Web Worker): log spectral-flux onsets → tempo from an
   autocorrelation comb with a tempo prior → beat times with Ellis' dynamic-programming tracker (follows small tempo
   drifts) → downbeats from low-end energy per bar position. On synthetic tests it lands within ±3 ms.
2. **Beat grid** (`src/audio/BeatGrid.js`) maps seconds ↔ beats. You can halve/double the tempo, shift the bar,
   nudge the sync in ms, and turn on a click track to check it by ear.
3. **Clip rhythm** (`src/dance/ClipMove.js`): each mocap clip is analysed for its own motion beats (periodic minima
   of joint speed), period and phase.
4. **Time-warping**: at time *t* the dancer is posed from "clip beat *k*" exactly when the music is on beat *k*,
   so every move hits the beat, even if the song drifts.
5. **Choreography** (`src/dance/Choreographer.js`): the song is cut into phrases on downbeats and each phrase gets a
   move whose energy matches the music's (quiet intro → calm moves, drop → big moves). Click a block in the timeline
   to override it.
6. **Deterministic rendering**: the dance, camera cuts, beat zooms and lights are all pure functions of *t*. Export
   renders frame *i* at exactly *t = i / fps* and muxes it with an offline render of the same mix, so the video can't
   drift out of sync.

## Features

- **Characters**: Ready Player Me avatar with 15 motion-captured dances; Mixamo X Bot / Soldier / Michelle; drop in
  your own Mixamo `.fbx`/`.glb` characters or animation-only dance FBX files. Outfit colours per mesh, materials,
  smile.
- **Procedural moves** (`src/dance/proceduralMoves.js`): 21 rig-independent moves (groove, two-step, clap, disco,
  robot, fist pump, jump, side step, body roll, running man, arm wave, cabbage patch, sprinkler, floss, raise the roof,
  kick step, salsa sway, groove & spin…) with two-bone leg IK, so every humanoid rig can dance.
- **Scenes**: ground-projected HDRI backgrounds (city street, plaza, golden hour, park, rooftop night; CC0 from Poly
  Haven), a photo-studio cyclorama, a beat-reactive neon club (LED floor, EQ wall, moving heads) and a synthwave set.
- **Look**: MSAA, GTAO ambient occlusion, bloom, film grade presets, grain, vignette, lens fringing, downbeat flash.
- **Camera director**: auto-cut on downbeats (every 1–8 bars), locked shots, beat-locked orbit or free camera; beat
  zoom punch and handheld shake.
- **Mixer**: any number of tracks with volume, pan, mute/solo and start offset; master EQ, glue compressor, meter.
- **Export**: 9:16, 16:9, 1:1 or 4:5 at 720p/1080p, 30/60 fps, whole song or a bar-snapped range. H.264 + AAC MP4.
  Needs a WebCodecs browser (current Chrome, Edge or Safari).

## Natural motion

- Beat times are smoothed (rolling least-squares, ±12 ms cap) so time-warped clips don't speed up/slow down per beat.
- Clips are preferred near their natural speed (*Natural speed*), so mocap isn't visibly sped up or slowed down.
- The beat-accent hip dip is absorbed by the knees with two-bone foot IK (feet stay planted).
- Procedural moves: overlapping action (hips lead, arms hit on the beat, head follows), moves arrive on the beat
  with ease-in/out, limb directions are slerped, forearm/shin swing from their parent (no wrist/knee twisting),
  relaxed fingers / fists, palms that turn (claps), breathing, small head drift, level gaze, heel peel.
- *Motion smoothness*: a small symmetric pose filter (±25 ms by default), still a pure function of time.

## Your own characters and dances

- **Characters** go in `public/models/<name>/` and are listed in `public/models/manifest.json`; the first entry is
  the default avatar. Mixamo, Ready Player Me and **Reallusion CC3 / ActorCore** skeletons are recognised. Clips made
  for a different skeleton are retargeted in world space (rest-pose corrected, so A-pose and T-pose rigs mix).
  An optional `pbr` block builds a proper PBR material from a texture set and adds outfit variants:

  ```json
  { "name": "Cesar", "file": "cesar/cesar.fbx", "family": "cc3",
    "pbr": { "normal": "normal.jpg", "roughness": "roughness.jpg", "metallic": "metallic.jpg", "ao": "ao.jpg",
             "defaultVariant": "01",
             "variants": [{ "id": "01", "name": "Olive", "color": "#4d5a2c", "map": "diffuse-01.jpg" }] } }
  ```
- **Dances** that should always be available: Mixamo → Animations → *FBX Binary, Without Skin* → put the files in
  `public/dances/` and list them in `public/dances/manifest.json`: `[{ "name": "Hip Hop", "file": "hip-hop.fbx" }]`.
- **Your own backgrounds**: drop a file on the page or use *Scene → Upload background*. A **video** (.mp4/.mov) or a
  **photo** (.jpg/.png/.webp) becomes a plate behind the dancer; a **360° panorama** (.hdr, .exr or any 2:1 image)
  wraps around the scene and lights the dancer like the built-in HDRIs. For videos and photos: The 3D camera is
  matched to the footage with the *Match the footage* sliders, the dancer casts a shadow onto it, camera shots become
  punch-in crops, and export decodes the exact video frame for every output frame. Static (tripod) shots work best.
- `public/models/*/` is git-ignored so licensed assets (e.g. ActorCore) aren't pushed to a public repo.

## Licences

- Ready Player Me's animation library is free to use but **only with Ready Player Me avatars**; the app offers those
  clips for RPM characters only and loads them from RPM's official repository.
- Poly Haven HDRIs are CC0. Mixamo characters/animations follow Adobe's Mixamo terms.

## Project layout

```
src/
  state/studio.js             app state (Zustand) + the controller that drives the engines
  audio/                      AudioEngine (mixer/transport/offline mix), beatAnalysis (+worker), BeatGrid, demoTrack
  dance/                      CharacterRig (pose buffers), ClipMove, proceduralMoves, Choreographer
  three/                      Stage (renderer/post/FX), environments, director (camera), loadAvatar, materials
  export/exportVideo.js       frame-exact MP4 export
  components/                 TopBar, LeftPanel, RightPanel, Timeline, Viewport, Overlays, ui primitives
public/models/manifest.json   your local Mixamo characters
```
