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
};

type PipelineResponse = ChunkPipelineState;

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

    const options: RunChunkPipelineOptions = {
      asin,
      kindle: session.kindle,
      renderingToken: session.renderingToken,
      startingPosition,
    };

    try {
      const result = await runChunkPipeline(options);
      return reply.status(200).send(result);
    } catch (error) {
      request.log.error({ err: error }, "Failed to run chunk pipeline");
      return reply
        .status(500)
        .send({ message: "Failed to run chunk pipeline" } as never);
    }
  });
}
