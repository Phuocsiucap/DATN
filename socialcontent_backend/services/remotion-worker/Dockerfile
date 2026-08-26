FROM node:20-bookworm-slim

WORKDIR /app
ENV CHROME_BIN=/usr/bin/chromium

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        chromium \
        fonts-liberation \
        fonts-noto-core \
        fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

COPY socialcontent_backend/services/remotion-worker/package*.json ./
RUN npm install --no-audit --no-fund

COPY socialcontent_backend/services/remotion-worker/src ./src
COPY socialcontent_backend/services/remotion-worker/tsconfig.json ./tsconfig.json

ENV NODE_ENV=production
CMD ["node", "src/worker.mjs"]
