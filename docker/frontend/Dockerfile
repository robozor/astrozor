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
    CMD wget -qO- http://127.0.0.1:5173/ >/dev/null 2>&1 || exit 1
# Note: explicit 127.0.0.1, not "localhost". In this container "localhost"
# resolves to ::1 (IPv6) but Vite binds to 0.0.0.0 (IPv4 only), so the
# default name resolution refuses the connection and Docker reports
# unhealthy even though the dev server is fine.

CMD ["npm", "run", "dev"]
