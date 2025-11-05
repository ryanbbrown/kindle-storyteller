import type { FastifyInstance } from "fastify";

import type { SessionStore } from "../session-store.js";
import { requireSession } from "../utils/auth.js";
import {
  runChunkPipeline,
  type ChunkPipelineState,
  type RunChunkPipelineOptions,
} from "../services/chunk-pipeline.js";
import { pipelineDebugLog, getPipelineLogPath } from "../utils/pipeline-debug-logger.js";

type PipelineParams = {
  asin: string;
};

type PipelineBody = {
  startingPosition?: number | string;
  numPages?: number | string;
  skipPages?: number | string;
  steps?: Array<"download" | "ocr">;
  ocr?: {
    startPage?: number;
    maxPages?: number;
  };
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
    await pipelineDebugLog("route.pipeline.request.received", {
      path: request.routerPath,
      asinParam: request.params.asin,
      body: request.body,
      logFile: getPipelineLogPath(),
    });

    const session = requireSession(store, request, reply);
    if (!session) {
      await pipelineDebugLog("route.pipeline.session.missing", {
        asinParam: request.params.asin,
      });
      return;
    }

    const asin = request.params.asin?.trim();
    if (!asin) {
      await pipelineDebugLog("route.pipeline.validation.noAsin", {
        asinParam: request.params.asin,
      });
      return reply
        .status(400)
        .send({ message: "asin is required" } as never);
    }

    const startingPosition = request.body?.startingPosition;
    if (startingPosition === undefined || startingPosition === null) {
      await pipelineDebugLog("route.pipeline.validation.noStartingPosition", {
        asin,
        body: request.body,
      });
      return reply
        .status(400)
        .send({ message: "startingPosition is required" } as never);
    }

    const options: RunChunkPipelineOptions = {
      asin,
      kindle: session.kindle,
      renderingToken: session.renderingToken,
      startingPosition,
      numPages: request.body?.numPages,
      skipPages: request.body?.skipPages,
      steps: request.body?.steps,
      ocr: request.body?.ocr,
    };

    await pipelineDebugLog("route.pipeline.options.ready", {
      asin,
      options,
    });

    try {
      const result = await runChunkPipeline(options);
      await pipelineDebugLog("route.pipeline.success", {
        asin,
        chunkId: result.chunkId,
        steps: result.steps,
        hasOcr: Boolean(result.ocr),
      });
      return reply.status(200).send(result);
    } catch (error) {
      if (error instanceof Error) {
        if (
          error.message.includes("Unsupported pipeline step") ||
          error.message.includes("Chunk download step was skipped")
        ) {
          await pipelineDebugLog("route.pipeline.userError", {
            asin,
            message: error.message,
          });
          return reply
            .status(400)
            .send({ message: error.message } as never);
        }
      }

      request.log.error({ err: error }, "Failed to run chunk pipeline");
      await pipelineDebugLog("route.pipeline.failure", {
        asin,
        error: error instanceof Error ? error.message : String(error),
      });
      return reply
        .status(500)
        .send({ message: "Failed to run chunk pipeline" } as never);
    }
  });
}
