import type { FastifyInstance } from "fastify";

import {
  openBenchmarkPayload,
  type BenchmarkPayload,
} from "../utils/benchmarks.js";
import type { TtsProvider } from "../types/chunk-metadata.js";

type BenchmarkParams = {
  asin: string;
  chunkId: string;
};

type BenchmarkQuery = {
  provider: TtsProvider;
};

/** Registers routes that expose benchmark checkpoints for a chunk. */
export async function registerBenchmarkRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: BenchmarkParams; Querystring: BenchmarkQuery; Reply: BenchmarkPayload }>(
    "/books/:asin/chunks/:chunkId/benchmarks",
    async (request, reply) => {
      const asin = request.params.asin?.trim();
      const chunkId = request.params.chunkId?.trim();
      const provider = request.query.provider;

      if (!asin || !chunkId) {
        return reply
          .status(400)
          .send({
            message: "asin and chunkId are required",
          } as never);
      }

      if (!provider || (provider !== "cartesia" && provider !== "elevenlabs")) {
        return reply
          .status(400)
          .send({ message: "provider query param is required (cartesia or elevenlabs)" } as never);
      }

      request.log.debug({ asin, chunkId, provider }, "Fetching benchmarks");

      try {
        const payload = await openBenchmarkPayload(asin, chunkId, provider);
        return reply.status(200).send(payload);
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode === 404) {
          request.log.warn({ asin, chunkId, provider }, "Benchmarks not found");
          return reply
            .status(404)
            .send({ message: "Benchmarks not found" } as never);
        }

        request.log.error({ err: error, asin, chunkId, provider }, "Failed to load benchmarks");
        return reply
          .status(500)
          .send({ message: "Failed to load benchmarks" } as never);
      }
    },
  );
}

/**
 * Route exposure only. Benchmark loading lives in lib/benchmarks.ts so the pipeline can reuse it.
 */
