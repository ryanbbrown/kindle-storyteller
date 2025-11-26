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
  textLength: number;
  totalDurationSeconds: number;
  benchmarkIntervalSeconds: number;
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
};

export type WordTimestamps = {
  words: string[];
  start: number[];
  end: number[];
};
