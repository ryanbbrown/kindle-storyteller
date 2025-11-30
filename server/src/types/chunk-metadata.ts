export type IsoDateTime = string;

export type TtsProvider = "cartesia" | "elevenlabs";

export interface RangeBound {
  positionId: number;
}

export interface RangePagesMetadata {
  count: number;
  indexStart?: number;
  indexEnd?: number;
}

export interface AudioArtifact {
  audioPath: string;
  alignmentPath: string;
  benchmarksPath: string;
  sourceTextPath: string;
  startPositionId: number;
  endPositionId: number;
  createdAt: IsoDateTime;
}

export interface RangeArtifacts {
  extractDir: string;
  pngDir?: string;
  combinedTextPath?: string;
  pagesDir?: string;
  contentTarPath?: string;
  audio?: Partial<Record<TtsProvider, AudioArtifact[]>>;
}

export interface CoverageRange {
  id: string;
  start: RangeBound;
  end: RangeBound;
  pages?: RangePagesMetadata;
  artifacts: RangeArtifacts;
  createdAt: IsoDateTime;
  updatedAt?: IsoDateTime;
}

export interface RendererCoverageMetadata {
  asin: string;
  updatedAt: IsoDateTime;
  ranges: CoverageRange[];
}
