# Astrozor Celery beat scheduler.
ARG BASE_IMAGE=astrozor/python-base:dev
FROM ${BASE_IMAGE}

WORKDIR /app/backend

USER root
COPY --chown=astrozor:astrozor backend/ /app/backend/
USER astrozor

ENV PYTHONPATH=/app/backend \
    DJANGO_SETTINGS_MODULE=astrozor.settings

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["celery", "-A", "astrozor", "beat", "--loglevel=info"]
