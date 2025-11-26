/** Barrel export for TTS services. */
export { generateChunkPreviewAudio as generateElevenLabsAudio } from "./elevenlabs.js";
export { generateChunkPreviewAudio as generateCartesiaAudio } from "./cartesia.js";
export {
  normalizeTextWithMap,
  computeSentenceSliceLength,
  buildCharToPositionIdMap,
  computeProportionalEndPosition,
  buildBenchmarkTimeline,
  recordChunkAudioArtifacts,
} from "./utils.js";
export type {
  BenchmarkEntry,
  ChunkAudioSummary,
  GenerateChunkAudioOptions,
} from "./elevenlabs.js";
