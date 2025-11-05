import path from "node:path";

import { ensureChunkDownloaded } from "../src/services/download.js";

async function debugFindExistingChunk() {
  const asin = "B0CPWQZNQB";
  const startingPosition = "3698;0";

  console.log("Calling ensureChunkDownloaded with:");
  console.log({ asin, startingPosition });

  try {
    const result = await ensureChunkDownloaded({
      asin,
      kindle: {} as any,
      renderingToken: "dummy",
      renderOptions: {
        startingPosition,
        numPages: 5,
        skipPages: 0,
      },
    });

    console.log("Result chunk ID:", result.chunkId);
    console.log("Metadata path:", result.metadataPath);
    console.log("Chunk dir:", result.chunkDir);
  } catch (error) {
    console.error("ensureChunkDownloaded threw:", error);
  }
}

void debugFindExistingChunk();
