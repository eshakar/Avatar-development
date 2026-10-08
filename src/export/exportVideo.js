import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  canEncodeAudio,
  getFirstEncodableVideoCodec,
} from 'mediabunny';

// Offline, frame-exact export: the audio mix is rendered once, then every video frame i is rendered at
// exactly t = start + i/fps and encoded with WebCodecs. Sync can't drift because nothing runs in real time.
export async function exportVideo({ stage, audio, start, end, width, height, fps, onProgress, signal }) {
  const videoCodec = await getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { width, height });
  if (!videoCodec) throw new Error('This browser has no WebCodecs video encoder. Use a recent Chrome, Edge or Safari.');
  const audioCodec = (await canEncodeAudio('aac')) ? 'aac' : (await canEncodeAudio('opus')) ? 'opus' : null;

  onProgress?.({ phase: 'Mixing audio', value: 0 });
  const mix = await audio.renderMix(start, end, 48000);

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const frames = Math.max(1, Math.round((end - start) * fps));
  const times = Array.from({ length: frames }, (_, i) => start + i / fps);
  const canvas = stage.beginExport(width, height, times);
  try {
    const video = new CanvasSource(canvas, {
      codec: videoCodec,
      bitrate: Math.round(width * height * fps * 0.16),
      keyFrameInterval: 2,
    });
    output.addVideoTrack(video, { frameRate: fps });
    let audioSource = null;
    if (audioCodec) {
      audioSource = new AudioBufferSource({ codec: audioCodec, bitrate: 192_000 });
      output.addAudioTrack(audioSource);
    }
    await output.start();
    if (audioSource) {
      await audioSource.add(mix);
      audioSource.close();
    }

    const began = performance.now();
    for (let i = 0; i < frames; i++) {
      if (signal?.aborted) {
        await output.cancel();
        throw new DOMException('Export cancelled', 'AbortError');
      }
      await stage.prepareFrame();
      stage.renderAt(times[i]);
      await video.add(i / fps, 1 / fps);
      if (i % 4 === 0 || i === frames - 1) {
        const elapsed = (performance.now() - began) / 1000;
        onProgress?.({ phase: 'Rendering frames', value: (i + 1) / frames, frame: i + 1, frames, eta: (elapsed / (i + 1)) * (frames - i - 1) });
        // Let the UI paint the progress bar.
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    video.close();
    onProgress?.({ phase: 'Finalising', value: 1 });
    await output.finalize();
    return { blob: new Blob([target.buffer], { type: 'video/mp4' }), videoCodec, audioCodec };
  } finally {
    stage.endExport();
  }
}
