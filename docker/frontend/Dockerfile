# Astrozor frontend — Vite dev server (Krok 0 dev image).
# Multi-stage prod image will be added in hardening phase (Krok 19).

FROM node:22-alpine

WORKDIR /app/frontend

# Install deps first (cache layer)
COPY frontend/package.json ./package.json
RUN npm install

# Copy source (will be overlaid by volume mount in dev)
COPY frontend/ ./

ENV NODE_ENV=development \
    HOST=0.0.0.0 \
    PORT=5173

EXPOSE 5173

HEALTHCHECK --interval=15s --timeout=5s --retries=10 --start-period=15s \
    CMD wget -qO- http://localhost:5173/ >/dev/null 2>&1 || exit 1

CMD ["npm", "run", "dev"]
