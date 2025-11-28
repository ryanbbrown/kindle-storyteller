import {
  TextToSpeechConvertWithTimestampsRequestOutputFormat as OutputFormatEnum,
  type TextToSpeechConvertWithTimestampsRequestOutputFormat,
} from "@elevenlabs/elevenlabs-js/api/resources/textToSpeech/types/TextToSpeechConvertWithTimestampsRequestOutputFormat.js";

export type ElevenLabsAudioConfig = {
  voiceId: string;
  modelId: string;
  outputFormat: TextToSpeechConvertWithTimestampsRequestOutputFormat;
  benchmarkIntervalSeconds: number;
  sentenceTarget: number;
};

let cachedAudioConfig: ElevenLabsAudioConfig | undefined;

const DEFAULT_OUTPUT_FORMAT: TextToSpeechConvertWithTimestampsRequestOutputFormat = OutputFormatEnum.Mp344100128;
const BENCHMARK_INTERVAL_SECONDS = 5;
// Laura voice, See more voices at: data/elevenlabs-voices.json or https://elevenlabs.io/app/voice-library
const DEFAULT_VOICE_ID = "FGY2WhTYpPnrIDTdsKH5";
const DEFAULT_MODEL_ID = "eleven_flash_v2_5";
export const ELEVENLABS_SENTENCE_TARGET = 2;

/** Returns the cached ElevenLabs configuration derived from environment defaults. */
export function getElevenLabsAudioConfig(): ElevenLabsAudioConfig {
  if (cachedAudioConfig) {
    return cachedAudioConfig;
  }

  cachedAudioConfig = {
    voiceId: DEFAULT_VOICE_ID,
    modelId: DEFAULT_MODEL_ID,
    outputFormat: DEFAULT_OUTPUT_FORMAT,
    benchmarkIntervalSeconds: BENCHMARK_INTERVAL_SECONDS,
    sentenceTarget: ELEVENLABS_SENTENCE_TARGET,
  };

  return cachedAudioConfig;
}
