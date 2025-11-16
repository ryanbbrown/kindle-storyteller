import {
  TextToSpeechConvertWithTimestampsRequestOutputFormat as OutputFormatEnum,
  type TextToSpeechConvertWithTimestampsRequestOutputFormat,
} from "@elevenlabs/elevenlabs-js/api/resources/textToSpeech/types/TextToSpeechConvertWithTimestampsRequestOutputFormat.js";

import "../env.js";

export type ElevenLabsAudioConfig = {
  voiceId: string;
  modelId: string;
  outputFormat: TextToSpeechConvertWithTimestampsRequestOutputFormat;
  benchmarkIntervalSeconds: number;
  sentenceTarget: number;
};

let cachedAudioConfig: ElevenLabsAudioConfig | undefined;

const DEFAULT_OUTPUT_FORMAT: TextToSpeechConvertWithTimestampsRequestOutputFormat =
  OutputFormatEnum.Mp344100128;
export const ELEVENLABS_SENTENCE_TARGET = 1;

/** Returns the cached ElevenLabs configuration derived from environment defaults. */
export function getElevenLabsAudioConfig(): ElevenLabsAudioConfig {
  if (cachedAudioConfig) {
    return cachedAudioConfig;
  }

  const benchmarkInterval = Number(
    process.env.ELEVENLABS_BENCHMARK_INTERVAL_SECONDS ?? "5",
  );
  cachedAudioConfig = {
    voiceId: process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb",
    modelId: process.env.ELEVENLABS_MODEL_ID ?? "eleven_flash_v2_5",
    outputFormat: DEFAULT_OUTPUT_FORMAT,
    benchmarkIntervalSeconds: Number.isFinite(benchmarkInterval)
      ? benchmarkInterval
      : 5,
    sentenceTarget: ELEVENLABS_SENTENCE_TARGET,
  };

  return cachedAudioConfig;
}
