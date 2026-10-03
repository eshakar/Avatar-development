# Avatar Lab

An interactive 3D avatar studio built with **Three.js** (rendering), **GSAP** (3D choreography) and
**Framer Motion** (UI), using rigged characters from **Mixamo**.

```bash
npm install
npm run dev     # http://localhost:5173
```

## What it does

- **Avatar gallery**: four Mixamo characters load out of the box (X Bot, Soldier, Michelle, Samba Dancer,
  hosted by three.js). Add as many of your own as you like.
- **Shared animation library**: every Mixamo rig uses the same `mixamorig*` bone names, so any clip plays on
  any avatar. Clips are retargeted through each rig's rest pose, which handles cm/m units, Y-up/Z-up
  armatures and differing bone axes.
- **Looks**: original, clay, toon, chrome and hologram materials, each with a tint.
- **Background music**: play/pause, volume and a track list in the control panel. A generated ambient pad
  works out of the box; add your own tracks too (see below). Tracks loop and crossfade when you switch.
- **Crowd mode**: spawns up to 60 avatars, each with a random rig, look and clip.
- **GSAP**: avatar spin-in/out, pedestal shockwave, camera fly-throughs, accent-light colour tweens and the
  staggered crowd entrance.
- **Framer Motion**: staggered panels, shared-layout selection pills, the loader, toasts and the drop overlay.

## Adding Mixamo avatars

1. Sign in at [mixamo.com](https://www.mixamo.com) → **Characters** → pick one.
2. **Download** → Format **FBX Binary (.fbx)**, Pose **T-pose**.
3. Either:
   - **drag the .fbx onto the page** (or use *Add Mixamo file*). It's added for this session, or
   - copy it into `public/models/` and list it in `public/models/manifest.json` so it's always there:

   ```json
   [
     { "name": "Y Bot", "file": "ybot.fbx", "accent": "#22d3ee", "emoji": "🧍" },
     { "name": "Remy", "file": "remy.fbx" }
   ]
   ```

### Adding Mixamo animations

On Mixamo, open **Animations**, pick one, and download as **FBX Binary, Without Skin**. Drop the file onto the page.
A file with no mesh is treated as an animation pack: its clips join the library and work on every avatar.
You can also download a character *with skin* and an animation, then add it via the manifest. Its clip gets
shared the same way.

## Adding background music

- **Drop an audio file** (.mp3, .wav, .ogg, .m4a, .aac, .flac, .webm) onto the page, or use *Add music file* in the
  Music section. It's added for this session and starts playing, or
- copy it into `public/music/` and list it in `public/music/manifest.json` so it's always there:

  ```json
  [
    { "name": "Lo-fi loop", "file": "lofi.mp3" },
    { "name": "Dance", "file": "dance.ogg", "tag": "120 bpm" }
  ]
  ```

Browsers only allow audio after the user interacts with the page, so music starts when you press play rather
than on load.

## Project layout

```
src/
  App.jsx                     state, uploads, drag & drop
  components/                 Framer Motion UI (gallery, controls, animation bar, overlays)
  data/avatars.js             built-in avatars + manifest loader
  three/AvatarStage.js        scene, lights, camera, GSAP choreography, crowd
  three/loadAvatar.js         GLB/FBX loading, size normalisation, rig description
  three/animationLibrary.js   shared clip pool + rest-pose retargeting
  three/materials.js          look styles
  audio/BackgroundMusic.js    music player, generated ambient pad, music manifest loader
public/models/manifest.json   your local Mixamo files
public/music/manifest.json    your local music tracks
```
