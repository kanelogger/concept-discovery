# syntax=docker/dockerfile:1.19.0@sha256:b6afd42430b15f2d2a4c5a02b919e98a525b785b1aaff16747d2f623364e39b6
FROM node:24.15-bookworm@sha256:f22d6a1f082c02f292e86929b5b0442ac2e5eaf438a5dea9b1566601c3e05940 AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY jsconfig.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY web ./web
COPY scripts/build-web.mjs ./scripts/build-web.mjs
RUN npm run build:web

FROM node:24.15-bookworm@sha256:f22d6a1f082c02f292e86929b5b0442ac2e5eaf438a5dea9b1566601c3e05940 AS app-base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY bin ./bin
COPY lib ./lib
COPY --exclude=share-materials --exclude=share-materials/** server ./server
COPY --from=builder /app/web/generated ./web/generated
EXPOSE 3000

FROM node:24.15-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d AS content-runtime
WORKDIR /app
COPY --from=app-base /app /app
COPY web/index.html web/favicon.svg web/share-cover.png web/routes.mjs web/initial-page.mjs ./web/
COPY scripts/start-content-service.mjs ./scripts/start-content-service.mjs
EXPOSE 3000
# Let glibc release large temporary allocations after Argon2 login work.
ENV GLIBC_TUNABLES=glibc.malloc.mmap_threshold=1048576
# Use V8's baseline compiler for the single-reader service. Higher compiler
# tiers add resident memory once the authenticated list and search paths warm up.
CMD ["node", "--max-opt=1", "--max-semi-space-size=1", "scripts/start-content-service.mjs"]

FROM app-base AS runtime
COPY web ./web
COPY scripts/service-start.mjs ./scripts/service-start.mjs
CMD ["node", "scripts/service-start.mjs"]
