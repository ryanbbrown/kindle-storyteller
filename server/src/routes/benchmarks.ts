import type { FastifyInstance } from "fastify";

import {
  openBenchmarkPayload,
  type BenchmarkPayload,
} from "../utils/benchmarks.js";

type BenchmarkParams = {
  asin: string;
  chunkId: string;
};

/** Registers routes that expose benchmark checkpoints for a chunk. */
export async function registerBenchmarkRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: BenchmarkParams; Reply: BenchmarkPayload }>(
    "/books/:asin/chunks/:chunkId/benchmarks",
    async (request, reply) => {
      const asin = request.params.asin?.trim();
      const chunkId = request.params.chunkId?.trim();

      if (!asin || !chunkId) {
        return reply
          .status(400)
          .send({
            message: "asin and chunkId are required",
          } as never);
      }

      request.log.debug({ asin, chunkId }, "Fetching benchmarks");

      try {
        const payload = await openBenchmarkPayload(asin, chunkId);
        return reply.status(200).send(payload);
      } catch (error) {
        if ((error as { statusCode?: number }).statusCode === 404) {
          request.log.warn({ asin, chunkId }, "Benchmarks not found");
          return reply
            .status(404)
            .send({ message: "Benchmarks not found" } as never);
        }

        request.log.error({ err: error, asin, chunkId }, "Failed to load benchmarks");
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
