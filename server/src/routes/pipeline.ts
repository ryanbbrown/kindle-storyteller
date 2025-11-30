import type { FastifyInstance } from "fastify";

import type { SessionStore } from "../session-store.js";
import { requireSession } from "../utils/auth.js";
import {
  runChunkPipeline,
  type ChunkPipelineState,
  type RunChunkPipelineOptions,
} from "../services/chunk-pipeline.js";

type PipelineParams = {
  asin: string;
};

type PipelineBody = {
  startingPosition?: number | string;
  audioProvider: "cartesia" | "elevenlabs";
  skipLlmPreprocessing?: boolean;
  durationMinutes?: number;
};

type PipelineResponse = ChunkPipelineState;

/** Registers pipeline routes for running the audiobook pipeline. */
export async function registerPipelineRoutes(
  app: FastifyInstance,
  store: SessionStore
): Promise<void> {
  app.post<{
    Params: PipelineParams;
    Body: PipelineBody;
    Reply: PipelineResponse;
  }>("/books/:asin/pipeline", async (request, reply) => {
    const session = requireSession(store, request, reply);
    if (!session) {
      return;
    }

    const asin = request.params.asin?.trim();
    if (!asin) {
      return reply
        .status(400)
        .send({ message: "asin is required" } as never);
    }

    const startingPosition = request.body?.startingPosition;
    if (startingPosition === undefined || startingPosition === null) {
      return reply
        .status(400)
        .send({ message: "startingPosition is required" } as never);
    }

    const audioProvider = request.body?.audioProvider;
    if (audioProvider !== "cartesia" && audioProvider !== "elevenlabs") {
      return reply
        .status(400)
        .send({ message: "audioProvider must be 'cartesia' or 'elevenlabs'" } as never);
    }

    const durationMinutes = request.body?.durationMinutes;
    if (durationMinutes !== undefined && (durationMinutes < 1 || durationMinutes > 8)) {
      return reply
        .status(400)
        .send({ message: "durationMinutes must be between 1 and 8" } as never);
    }

    request.log.info(
      { asin, startingPosition, audioProvider, durationMinutes },
      "Starting chunk pipeline"
    );

    const skipLlmPreprocessing = request.body?.skipLlmPreprocessing ?? false;

    const options: RunChunkPipelineOptions = {
      asin,
      kindle: session.kindle,
      startingPosition,
      audioProvider,
      skipLlmPreprocessing,
      durationMinutes,
    };

    try {
      const result = await runChunkPipeline(options);
      request.log.info(
        { asin, chunkId: result.chunkId, steps: result.steps },
        "Pipeline completed"
      );
      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ err: error, asin }, "Failed to run chunk pipeline");
      return reply
        .status(500)
        .send({ message: "Failed to run chunk pipeline" } as never);
    }
  });
}
