import type { FastifyInstance } from "fastify";

import type { SessionStore } from "../session-store.js";
import { serializeBooks, serializeBookDetails } from "../lib/serializers.js";
import { requireSession } from "../utils/auth.js";

type BooksQuerystring = {
  refresh?: string | boolean;
};

type BooksResponse = {
  books: ReturnType<typeof serializeBooks>;
  refreshed: boolean;
};

type BookDetailsParams = {
  asin: string;
};

type BookDetailsResponse = {
  title: string;
  coverImage: string;
  currentPosition: number;
  length: number;
};

/** Registers book listing and diagnostics routes. */
export async function registerBooksRoutes(
  app: FastifyInstance,
  store: SessionStore
): Promise<void> {
  app.get<{ Querystring: BooksQuerystring; Reply: BooksResponse }>(
    "/books",
    async (request, reply) => {
      const session = requireSession(store, request, reply);
      if (!session) {
        return;
      }

      const refresh = isTruthy(request.query?.refresh);
      let books = session.booksCache;

      if (refresh || books.length === 0) {
        books = await session.kindle.books();
        session.booksCache = books;
      }

      return reply.send({
        books: serializeBooks(books),
        refreshed: refresh,
      });
    }
  );

  app.get<{ Params: BookDetailsParams; Reply: BookDetailsResponse }>(
    "/books/:asin/full-details",
    async (request, reply) => {
      const session = requireSession(store, request, reply);
      if (!session) {
        return;
      }

      const { asin } = request.params;

      // Fetch the book from the cached books list
      let books = session.booksCache;
      if (books.length === 0) {
        books = await session.kindle.books();
        session.booksCache = books;
      }

      const book = books.find((b) => b.asin === asin);
      if (!book) {
        return reply.status(404).send({
          error: "Book not found",
          message: `No book found with ASIN ${asin}`,
        } as any);
      }

      // Fetch light details first, then full details
      const lightDetails = await book.details();
      const fullDetails = await book.fullDetails(lightDetails);

      // Serialize and return the response
      const response = serializeBookDetails(fullDetails);

      return reply.send(response);
    }
  );

}

function isTruthy(value: string | boolean | undefined): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value === "1" || value.toLowerCase() === "true";
  }
  return false;
}
