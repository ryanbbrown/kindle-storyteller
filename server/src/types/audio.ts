export type BenchmarkEntry = {
  timeSeconds: number;
  charIndexStart: number;
  charIndexEnd: number;
  kindlePositionIdStart: number;
  kindlePositionIdEnd: number;
  textNormalized: string;
  textOriginal: string;
};

export type ChunkAudioSummary = {
  asin: string;
  chunkId: string;
  audioPath: string;
  alignmentPath: string;
  benchmarksPath: string;
  sourceTextPath: string;
  textLength: number;
  totalDurationSeconds: number;
  benchmarkIntervalSeconds: number;
  ttsProvider: "cartesia" | "elevenlabs";
  startPositionId: number;
  endPositionId: number;
};

export type GenerateChunkAudioOptions = {
  asin: string;
  chunkId: string;
  chunkDir: string;
  range: {
    start: { positionId: number };
    end: { positionId: number };
  };
  combinedTextPath: string;
  skipLlmPreprocessing?: boolean;
  durationMinutes?: number;
  requestedStartPositionId?: number;
};

export type WordTimestamps = {
  words: string[];
  start: number[];
  end: number[];
};
