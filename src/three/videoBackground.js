import * as THREE from 'three';
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny';

export const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'mkv'];
// .webm can be either, so trust the MIME type there.
export const isVideoFile = (file) =>
  file.type?.startsWith('video/') || VIDEO_EXT.includes(file.name.split('.').pop().toLowerCase());

export const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'hdr', 'exr'];
export const isImageFile = (file) =>
  file.type?.startsWith('image/') || IMAGE_EXT.includes(file.name.split('.').pop().toLowerCase());
const extOf = (file) => file.name.split('.').pop().toLowerCase();

// 360° panoramas: HDR/EXR files, or any 2:1 image.
export async function isPanorama(file) {
  if (['hdr', 'exr'].includes(extOf(file))) return true;
  try {
    const bmp = await createImageBitmap(file);
    const ratio = bmp.width / bmp.height;
    bmp.close();
    return ratio > 1.9 && ratio < 2.1;
  } catch {
    return false;
  }
}

// A still photo used as a plate: same interface as the video plate, but nothing to sync or decode.
export async function createImageBackground(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'flipY' });
  const texture = new THREE.Texture(bitmap);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.needsUpdate = true;
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = 180;
  thumbCanvas.height = Math.round((180 * bitmap.height) / bitmap.width);
  const tctx = thumbCanvas.getContext('2d');
  tctx.scale(1, -1);
  tctx.drawImage(bitmap, 0, -thumbCanvas.height, thumbCanvas.width, thumbCanvas.height);
  return {
    kind: 'photo',
    static: true,
    name: file.name.replace(/\.[^.]+$/, ''),
    file,
    texture,
    width: bitmap.width,
    height: bitmap.height,
    duration: Infinity,
    thumb: thumbCanvas.toDataURL('image/jpeg', 0.8),
    sync() {},
    beginExport() {
      return texture;
    },
    async nextExportFrame() {
      return texture;
    },
    endExport() {},
    dispose() {
      texture.dispose();
      bitmap.close();
    },
  };
}

// A real (moving) video plate behind the dancer. Preview uses a <video> element kept in sync with the
// music; export decodes the exact frame for every output frame with WebCodecs, so it stays frame-accurate.
export async function createVideoBackground(file) {
  const url = URL.createObjectURL(file);
  const el = document.createElement('video');
  el.src = url;
  el.muted = true;
  el.loop = true;
  el.playsInline = true;
  el.crossOrigin = 'anonymous';
  el.preload = 'auto';
  await new Promise((resolve, reject) => {
    el.onloadeddata = resolve;
    el.onerror = () => reject(new Error(`Can't play ${file.name} in this browser`));
  });

  const texture = new THREE.VideoTexture(el);
  texture.colorSpace = THREE.SRGBColorSpace;

  // Small poster for the background picker.
  const thumbCanvas = document.createElement('canvas');
  thumbCanvas.width = 180;
  thumbCanvas.height = Math.round((180 * el.videoHeight) / el.videoWidth);
  thumbCanvas.getContext('2d').drawImage(el, 0, 0, thumbCanvas.width, thumbCanvas.height);

  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  const track = await input.getPrimaryVideoTrack();

  const bg = {
    kind: 'video',
    static: false,
    name: file.name.replace(/\.[^.]+$/, ''),
    file,
    el,
    texture,
    width: el.videoWidth,
    height: el.videoHeight,
    duration: el.duration || 1,
    thumb: thumbCanvas.toDataURL('image/jpeg', 0.8),
    track,
    exportTexture: null,
    frames: null,

    // Live preview: follow the transport, re-seek only when drifting.
    sync(t, playing) {
      const target = t % this.duration;
      const drift = Math.abs(el.currentTime - target);
      if (playing) {
        if (el.paused) el.play().catch(() => {});
        if (drift > 0.12 && drift < this.duration - 0.12) el.currentTime = target;
      } else {
        if (!el.paused) el.pause();
        if (drift > 1 / 60) el.currentTime = target;
      }
      // Paused/seeked videos don't always fire frame callbacks; upload the current frame ourselves.
      if (el.readyState >= 2) texture.needsUpdate = true;
    },

    // Export: a decoder walks the exact timestamps we'll render.
    beginExport(times, width, height) {
      el.pause();
      const sink = new CanvasSink(track, { width, height, fit: 'cover', poolSize: 2 });
      this.frames = sink.canvasesAtTimestamps(times.map((t) => t % this.duration));
      this.exportTexture ??= new THREE.CanvasTexture(document.createElement('canvas'));
      this.exportTexture.colorSpace = THREE.SRGBColorSpace;
      return this.exportTexture;
    },

    async nextExportFrame() {
      const { value } = await this.frames.next();
      if (value?.canvas) {
        this.exportTexture.image = value.canvas;
        this.exportTexture.needsUpdate = true;
      }
      return this.exportTexture;
    },

    endExport() {
      this.frames?.return?.();
      this.frames = null;
    },

    dispose() {
      el.pause();
      el.removeAttribute('src');
      URL.revokeObjectURL(url);
      texture.dispose();
      this.exportTexture?.dispose();
      input.dispose?.();
    },
  };
  return bg;
}

// Crops a texture so it covers a frame of the given aspect (like CSS object-fit: cover).
export function coverFit(texture, mediaAspect, frameAspect, fitted = false) {
  texture.matrixAutoUpdate = true;
  if (fitted) {
    // Already cropped to the frame by the decoder.
    texture.repeat.set(1, 1);
    texture.offset.set(0, 0);
    return;
  }
  if (mediaAspect > frameAspect) {
    texture.repeat.set(frameAspect / mediaAspect, 1);
    texture.offset.set((1 - texture.repeat.x) / 2, 0);
  } else {
    texture.repeat.set(1, mediaAspect / frameAspect);
    texture.offset.set(0, (1 - texture.repeat.y) / 2);
  }
}
