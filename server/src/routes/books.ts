import fs from "node:fs/promises";
import path from "node:path";

import type { FastifyInstance } from "fastify";

import { env } from "../config/env.js";
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

      // Save book info for offline access by audiobooks endpoint
      await saveBookInfo(asin, {
        title: fullDetails.title,
        coverImage: fullDetails.largeCoverUrl,
        length: fullDetails.endPosition,
      });

      // Serialize and return the response
      const response = serializeBookDetails(fullDetails);

      return reply.send(response);
    }
  );
}

type BookInfo = {
  title: string;
  coverImage: string;
  length: number;
};

/** Saves book info to disk for use by the audiobooks listing. */
async function saveBookInfo(asin: string, info: BookInfo): Promise<void> {
  const asinDir = path.join(env.storageDir, asin);
  await fs.mkdir(asinDir, { recursive: true });
  const bookInfoPath = path.join(asinDir, "book-info.json");
  await fs.writeFile(bookInfoPath, JSON.stringify(info, null, 2), "utf8");
}
