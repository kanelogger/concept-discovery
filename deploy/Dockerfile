# syntax=docker/dockerfile:1.19.0@sha256:b6afd42430b15f2d2a4c5a02b919e98a525b785b1aaff16747d2f623364e39b6
FROM node:24.15-bookworm@sha256:f22d6a1f082c02f292e86929b5b0442ac2e5eaf438a5dea9b1566601c3e05940 AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY jsconfig.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY web ./web
COPY scripts/build-web.mjs ./scripts/build-web.mjs
RUN npm run build:web

FROM node:24.15-bookworm@sha256:f22d6a1f082c02f292e86929b5b0442ac2e5eaf438a5dea9b1566601c3e05940 AS runtime
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY bin ./bin
COPY lib ./lib
COPY --exclude=share-materials --exclude=share-materials/** server ./server
COPY web ./web
COPY --from=builder /app/web/generated ./web/generated
COPY scripts/service-start.mjs ./scripts/service-start.mjs
EXPOSE 3000
CMD ["node", "scripts/service-start.mjs"]
