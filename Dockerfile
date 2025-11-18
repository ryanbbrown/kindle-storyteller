# syntax=docker/dockerfile:1.7

# Build the tls-client binary from source for the Linux target Fly uses.
FROM golang:1.24.4-bookworm AS tls-client-builder
WORKDIR /src
COPY tls-client-api/go.mod tls-client-api/go.sum ./
RUN go mod download
COPY tls-client-api .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/tls-client ./cmd/tls-client-api/main.go

# Compile the Fastify server (including the local kindle-api workspace) and prune dev deps.
FROM node:20-bookworm AS server-builder
WORKDIR /workspace
COPY server ./server
RUN rm -rf ./server/node_modules ./server/dist
COPY kindle-api ./kindle-api
WORKDIR /workspace/server
RUN corepack enable pnpm \
  && pnpm install --frozen-lockfile \
  && pnpm run build \
  && pnpm prune --prod

# Final runtime image: Python base for glyph extraction + Node + Go proxy binaries.
FROM python:3.12-slim AS runtime
ENV APP_HOME=/app
WORKDIR ${APP_HOME}

# Install OS packages, including Node 20, Tesseract, Cairo/Pango libs, and tini.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl gnupg; \
    mkdir -p /etc/apt/keyrings; \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg; \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" > /etc/apt/sources.list.d/nodesource.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      bash \
      build-essential \
      fonts-dejavu-core \
      git \
      libgdk-pixbuf-2.0-0 \
      libjpeg62-turbo \
      libopenjp2-7 \
      libpangocairo-1.0-0 \
      libpango-1.0-0 \
      libcairo2 \
      libtiff6 \
      nodejs \
      procps \
      tini \
      tesseract-ocr \
      wget \
      xz-utils \
      zlib1g; \
    rm -rf /var/lib/apt/lists/*

# Install uv (Python package manager) globally for the glyph-extraction pipeline.
ENV UV_LINK_MODE=copy
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
  && ln -s /root/.local/bin/uv /usr/local/bin/uv

# Install yq (v4) binary for tls-client config templating.
RUN curl -L "https://github.com/mikefarah/yq/releases/download/v4.44.3/yq_linux_amd64" -o /usr/local/bin/yq \
  && chmod +x /usr/local/bin/yq

COPY glyph-extraction ./glyph-extraction
RUN cd glyph-extraction && uv sync --frozen --no-dev

# Copy the prebuilt Fastify server output into the runtime and ensure data dir exists.
COPY server ./server
RUN rm -rf ./server/node_modules ./server/dist
COPY --from=server-builder /workspace/server/dist ./server/dist
COPY --from=server-builder /workspace/server/node_modules ./server/node_modules
COPY --from=server-builder /workspace/server/package.json ./server/package.json
COPY --from=server-builder /workspace/server/pnpm-lock.yaml ./server/pnpm-lock.yaml
RUN mkdir -p /app/server/data/books

# Copy the tls-client config, entrypoint, and binary to paths expected by the upstream script.
COPY tls-client-api/cmd/tls-client-api/config.dist.yml ./config.dist.yml
COPY tls-client-api/cmd/tls-client-api/entrypoint.sh ./tls-client-entrypoint.sh
COPY --from=tls-client-builder /out/tls-client ./tls-client-api
RUN chmod +x ./tls-client-entrypoint.sh ./tls-client-api

# Ship the process supervisor that starts both services.
COPY start.sh ./start.sh
RUN chmod +x ./start.sh

ENV HOST=0.0.0.0 \
    PORT=3000 \
    TLS_PROXY_PORT=8080 \
    TLS_PROXY_HEALTH_PORT=8081 \
    UV_PROJECT_ENVIRONMENT=.venv \
    GLYPH_EXTRACTION_DIR=/app/glyph-extraction

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--", "/app/start.sh"]
