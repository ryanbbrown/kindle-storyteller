export type CartesiaAudioConfig = {
  voiceId: string;
  modelId: string;
  outputFormat: {
    container: "raw";
    encoding: "pcm_f32le";
    sample_rate: number;
  };
  speed: number;
  benchmarkIntervalSeconds: number;
};

let cachedAudioConfig: CartesiaAudioConfig | undefined;

const BENCHMARK_INTERVAL_SECONDS = 5;
// Tessa voice; see more voices at: data/cartesia-voices.json or https://play.cartesia.ai/
const DEFAULT_VOICE_ID = "f786b574-daa5-4673-aa0c-cbe3e8534c02";
const DEFAULT_MODEL_ID = "sonic-3";
const DEFAULT_SPEED = 0.9;

/** Returns the cached Cartesia configuration derived from environment defaults. */
export function getCartesiaAudioConfig(): CartesiaAudioConfig {
  if (cachedAudioConfig) {
    return cachedAudioConfig;
  }

  cachedAudioConfig = {
    voiceId: DEFAULT_VOICE_ID,
    modelId: DEFAULT_MODEL_ID,
    outputFormat: {
      container: "raw",
      encoding: "pcm_f32le",
      sample_rate: 44100,
    },
    speed: DEFAULT_SPEED,
    benchmarkIntervalSeconds: BENCHMARK_INTERVAL_SECONDS,
  };

  return cachedAudioConfig;
}
