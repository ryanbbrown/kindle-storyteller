import { randomUUID } from "node:crypto";

import {
  Kindle,
  type KindleBook,
  type KindleConfiguration,
  type KindleRequiredCookies,
} from "kindle-api";

export type SessionContext = {
  id: string;
  kindle: Kindle;
  renderingToken: string;
  rendererRevision: string;
  guid: string;
  createdAt: number;
  lastAccessedAt: number;
  booksCache: KindleBook[];
  cache: Map<string, any>;
};

export type CreateSessionInput = {
  cookies: string | KindleRequiredCookies;
  deviceToken: string;
  renderingToken: string;
  rendererRevision: string;
  guid: string;
  tlsServer: KindleConfiguration["tlsServer"];
};

export class SessionStore {
  private readonly sessions = new Map<string, SessionContext>();

  constructor(private readonly ttlMs: number) {}

  /** Creates a Kindle session context backed by the Kindle API client. */
  async createSession(input: CreateSessionInput): Promise<SessionContext> {
    const kindle = await Kindle.fromConfig({
      cookies: input.cookies,
      deviceToken: input.deviceToken,
      tlsServer: input.tlsServer,
    });

    const sessionId = randomUUID();
    const now = Date.now();
    const context: SessionContext = {
      id: sessionId,
      kindle,
      renderingToken: input.renderingToken,
      rendererRevision: input.rendererRevision,
      guid: input.guid,
      createdAt: now,
      lastAccessedAt: now,
      booksCache: [...kindle.defaultBooks],
      cache: new Map(),
    };

    this.sessions.set(sessionId, context);
    return context;
  }

  get(sessionId: string): SessionContext | undefined {
    const context = this.sessions.get(sessionId);
    if (!context) {
      return undefined;
    }
    if (this.isExpired(context)) {
      this.sessions.delete(sessionId);
      return undefined;
    }
    context.lastAccessedAt = Date.now();
    return context;
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  touch(sessionId: string): void {
    const context = this.sessions.get(sessionId);
    if (!context) return;
    context.lastAccessedAt = Date.now();
  }

  gc(): number {
    const now = Date.now();
    let removed = 0;
    for (const [id, context] of this.sessions.entries()) {
      if (now - context.lastAccessedAt > this.ttlMs) {
        this.sessions.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  private isExpired(context: SessionContext): boolean {
    return Date.now() - context.lastAccessedAt > this.ttlMs;
  }
}
