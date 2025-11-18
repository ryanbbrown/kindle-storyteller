export type IsoDateTime = string;

export interface RangeBound {
  positionId: number;
}

export interface RangePagesMetadata {
  count: number;
  indexStart?: number;
  indexEnd?: number;
}

export interface RangeArtifacts {
  extractDir: string;
  pngDir?: string;
  combinedTextPath?: string;
  pagesDir?: string;
  audioPath?: string;
  contentTarPath?: string;
  [key: string]: string | undefined;
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
