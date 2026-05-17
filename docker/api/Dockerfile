# Astrozor API container — Django + Ninja, ASGI via Daphne (dev) / Gunicorn+Uvicorn (prod).
ARG BASE_IMAGE=astrozor/python-base:dev
FROM ${BASE_IMAGE}

WORKDIR /app/backend

USER root
COPY --chown=astrozor:astrozor backend/ /app/backend/
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends gosu \
 && rm -rf /var/lib/apt/lists/* \
 && chmod +x /app/backend/entrypoint.sh \
 && mkdir -p /var/lib/astrozor/media/uploads /var/lib/astrozor/pmtiles \
 && chown -R astrozor:astrozor /var/lib/astrozor
# Stay as root so entrypoint.sh can chmod the bind-mounted docker.sock
# (used by admin live-progress code); entrypoint then drops to astrozor
# via gosu before exec'ing the app.

ENV PYTHONPATH=/app/backend \
    DJANGO_SETTINGS_MODULE=astrozor.settings

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=5s --retries=10 --start-period=20s \
    CMD curl -fsS http://localhost:8000/api/v1/healthz || exit 1

# Dev default — Daphne ASGI server with auto-reload (Django's runserver-like via uvicorn)
# In prod we'd use gunicorn + uvicorn workers.
ENTRYPOINT ["/usr/bin/tini", "--", "/app/backend/entrypoint.sh"]
CMD ["uvicorn", "astrozor.asgi:application", "--host", "0.0.0.0", "--port", "8000", "--reload"]
