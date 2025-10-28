import type { FastifyInstance } from "fastify";

import type { SessionStore } from "../session-store.js";
import { serializeBooks } from "../lib/serializers.js";
import { requireSession } from "../utils/auth.js";

type BooksQuerystring = {
  refresh?: string | boolean;
};

type BooksResponse = {
  books: ReturnType<typeof serializeBooks>;
  refreshed: boolean;
};

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
