"""WSGI entrypoint (kept for compatibility; ASGI is primary)."""

import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "astrozor.settings")

application = get_wsgi_application()
