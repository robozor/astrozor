# Astrozor — Playwright E2E runner.
# Uses official Microsoft Playwright image which includes browsers (~1.5 GB).
FROM mcr.microsoft.com/playwright:v1.49.1-noble

WORKDIR /app/e2e

COPY e2e/package.json /app/e2e/package.json
RUN npm install --no-audit --no-fund

COPY e2e/ /app/e2e/

ENV CI=true \
    E2E_BASE_URL=http://proxy

CMD ["npx", "playwright", "test"]
