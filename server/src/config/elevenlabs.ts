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
  maxCharacters?: number;
  sentenceTarget: number;
  sentenceMaxChars: number;
};

export const ELEVENLABS_SENTENCE_MAX_CHARS = 1200;

let cachedAudioConfig: ElevenLabsAudioConfig | undefined;

const DEFAULT_OUTPUT_FORMAT: TextToSpeechConvertWithTimestampsRequestOutputFormat =
  OutputFormatEnum.Mp344100128;

/** Returns the cached ElevenLabs configuration derived from environment defaults. */
export function getElevenLabsAudioConfig(): ElevenLabsAudioConfig {
  if (cachedAudioConfig) {
    return cachedAudioConfig;
  }

  const benchmarkInterval = Number(
    process.env.ELEVENLABS_BENCHMARK_INTERVAL_SECONDS ?? "5",
  );
  const sentenceTarget = Number(process.env.ELEVENLABS_SENTENCE_TARGET ?? "3");
  const maxCharsRaw = process.env.ELEVENLABS_MAX_CHARACTERS;
  const maxCharsParsed =
    maxCharsRaw !== undefined ? Number(maxCharsRaw) : undefined;

  cachedAudioConfig = {
    voiceId: process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb",
    modelId: process.env.ELEVENLABS_MODEL_ID ?? "eleven_flash_v2_5",
    outputFormat: DEFAULT_OUTPUT_FORMAT,
    benchmarkIntervalSeconds: Number.isFinite(benchmarkInterval)
      ? benchmarkInterval
      : 5,
    maxCharacters:
      maxCharsParsed !== undefined && Number.isFinite(maxCharsParsed)
        ? maxCharsParsed
        : undefined,
    sentenceTarget:
      Number.isFinite(sentenceTarget) && sentenceTarget > 0
        ? sentenceTarget
        : 3,
    sentenceMaxChars: ELEVENLABS_SENTENCE_MAX_CHARS,
  };

  return cachedAudioConfig;
}
