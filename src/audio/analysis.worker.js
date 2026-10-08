import { analyzeBeats } from './beatAnalysis.js';

self.onmessage = ({ data }) => {
  const { id, samples, sampleRate, options } = data;
  try {
    const result = analyzeBeats(samples, sampleRate, options);
    const transfer = [result.beats, result.beatEnergy, result.beatAccent, result.pulse, result.peaks].map((a) => a.buffer);
    self.postMessage({ id, result }, transfer);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message ?? err) });
  }
};
