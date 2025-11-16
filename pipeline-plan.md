# Chunk Pipeline Refactor Plan

## Goals
- Replace the separate `/content` and `/ocr` routes with a single `/books/:asin/pipeline` endpoint.
- Make the **entire** chunk pipeline idempotent: rerunning the same request for a `chunkId` must reuse existing artifacts and metadata without re-downloading or reprocessing.
- Keep naming consistent with hyphen-separated filenames.

## Server Work
1. **Create `server/src/services/chunk-pipeline.ts`**
   - Export `runChunkPipeline(options)` where `options` includes:
     - `asin`, `startingPosition` (required)
   - Flow (idempotent end-to-end):
     1. Inspect storage/metadata to determine which stages (download, OCR, audio) are required for the requested range.
     2. Call `ensureChunkDownloaded` (from `download.ts`) when a download is needed (or simply to load the cached chunk). This helper will:
        - Check whether the chunk already exists with the needed artifacts.
        - If it is present, return immediately without fetching anything.
        - Otherwise download/extract/update metadata to produce the chunk.
        - Return `{ chunkId, chunkDir, metadata, artifactPaths }`.
     3. Run OCR/audio helpers only when their outputs are missing, otherwise reuse cached artifacts.
        - Detect when OCR results are already finished; in that case, do nothing and return the existing state.
        - Otherwise, execute the Python pipeline, place results inside the chunk folder, and update metadata.
     3. Aggregate the final state into a single payload for the route.

2. **Add helpers**
   - `server/src/services/download.ts`: contains current renderer download logic refactored from `content-service.ts`.
   - `server/src/services/ocr.ts`: wraps the pipeline runner, accepts chunk paths, updates metadata.
   - Both helpers must be idempotent: when their outputs already exist, they must exit without performing any new work.

3. **New route**
   - `server/src/routes/pipeline.ts`: POST `/books/:asin/pipeline`.
   - Validates request body, calls `runChunkPipeline`, and returns the payload.
   - Remove the old `/content` and `/ocr` routes once the new route works.

4. **Cleanup**
   - Delete `content-service.ts`, `ocr-service.ts`, and any unused metadata utilities replaced by the new helpers.
   - Update server documentation (`server/README.md`) to describe the new endpoint and directory structure.

## iOS App Updates
1. Replace the separate content/OCR calls with a single API method (e.g., `runPipeline`).
2. Adjust `ContentView` to hit the new endpoint when the user taps “Start audiobook,” then display chunk info, OCR results, etc. from the combined response.
3. Update models to match the new payload (chunk metadata, pages, combined text path).

## Validation
1. End-to-end manual test: start the server, run the pipeline twice with the same parameters, ensure no redundant downloads/OCR work and both server response and chunk folder remain stable.
2. Update or add a smoke script (optional) to hit `/pipeline` twice and confirm cached runs do not reprocess unnecessary stages.
