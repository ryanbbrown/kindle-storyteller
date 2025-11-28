import type { FastifyInstance } from "fastify";

import type { SessionStore } from "../session-store.js";
import { serializeBookDetails } from "../utils/serializers.js";
import { requireSession } from "../utils/auth.js";

type BookDetailsParams = {
  asin: string;
};

type BookDetailsResponse = {
  title: string;
  coverImage: string;
  currentPosition: number;
  length: number;
};

/** Registers book details routes. */
export async function registerBooksRoutes(
  app: FastifyInstance,
  store: SessionStore
): Promise<void> {
  app.get<{ Params: BookDetailsParams; Reply: BookDetailsResponse }>(
    "/books/:asin/full-details",
    async (request, reply) => {
      const session = requireSession(store, request, reply);
      if (!session) {
        return;
      }

      const { asin } = request.params;
      request.log.info({ asin }, "Fetching book details");

      // Fetch the book from the cached books list
      let books = session.booksCache;
      if (books.length === 0) {
        request.log.debug("Books cache empty, fetching from Kindle");
        books = await session.kindle.books();
        session.booksCache = books;
      }

      const book = books.find((b) => b.asin === asin);
      if (!book) {
        request.log.warn({ asin }, "Book not found");
        return reply.status(404).send({
          error: "Book not found",
          message: `No book found with ASIN ${asin}`,
        } as any);
      }

      const fullDetails = await session.kindle.fullBookDetails(book);
      request.log.info({ asin, title: fullDetails.title }, "Book details fetched");

      // Serialize and return the response
      const response = serializeBookDetails(fullDetails);

      return reply.send(response);
    }
  );

}
