# Astrozor Celery worker.
ARG BASE_IMAGE=astrozor/python-base:dev
FROM ${BASE_IMAGE}

WORKDIR /app/backend

USER root
COPY --chown=astrozor:astrozor backend/ /app/backend/
USER astrozor

ENV PYTHONPATH=/app/backend \
    DJANGO_SETTINGS_MODULE=astrozor.settings

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=20s \
    CMD celery -A astrozor inspect ping -d celery@$(hostname) || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["celery", "-A", "astrozor", "worker", "--loglevel=info", "--concurrency=2"]
