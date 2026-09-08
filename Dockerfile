# Doodle Studio — one container with Node, Chromium (Playwright) and ffmpeg.
# Runs the web UI on port 7860 (the port Hugging Face Spaces expects). Works on any Docker host too.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    PORT=7860 \
    DOODLE_OPEN=0 \
    DOODLE_WORKSPACE=/data/workspace \
    DOODLE_CACHE=/data/cache

# fonts for Arabic text fallback + a non-root user (required by Hugging Face Spaces)
RUN apt-get update && apt-get install -y --no-install-recommends fonts-noto-core fonts-noto-color-emoji && rm -rf /var/lib/apt/lists/* \
 && useradd -m -u 1000 app && mkdir -p /data && chown -R app:app /data

WORKDIR /app
COPY --chown=app:app package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --chown=app:app . .
RUN chown -R app:app /app

USER app
EXPOSE 7860
CMD ["node", "src/server.mjs"]
