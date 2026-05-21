"""
Astrozor Django settings.

Minimal Krok 0 configuration: single-file settings with env-driven overrides.
Will split into base/dev/prod when complexity warrants it.
"""

from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def env(key: str, default: str | None = None) -> str:
    value = os.environ.get(key, default)
    if value is None:
        raise RuntimeError(f"Missing required environment variable: {key}")
    return value


def env_bool(key: str, default: bool = False) -> bool:
    raw = os.environ.get(key)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def env_list(key: str, default: str = "") -> list[str]:
    raw = os.environ.get(key, default)
    return [item.strip() for item in raw.split(",") if item.strip()]


# ---- Core ----

SECRET_KEY = env("DJANGO_SECRET_KEY", "insecure-dev-secret-change-me")
DEBUG = env_bool("DJANGO_DEBUG", default=True)
ALLOWED_HOSTS = env_list(
    "DJANGO_ALLOWED_HOSTS",
    "localhost,127.0.0.1,astrozor.localhost,api,proxy",
)
CSRF_TRUSTED_ORIGINS = env_list(
    "DJANGO_CSRF_TRUSTED_ORIGINS",
    "http://astrozor.localhost,https://astrozor.localhost",
)

# ---- Applications ----

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # django.contrib.sitemaps is intentionally installed WITHOUT
    # django.contrib.sites — that way the sitemap framework falls back
    # to RequestSite (host derived from request.get_host()) instead of
    # the static Site DB row. We want the same code to emit the right
    # absolute URLs for astrozor.localhost in dev and astrozor.cz in
    # prod without per-environment DB seeding.
    "django.contrib.sitemaps",
    # Third-party
    "taggit",
    # Astrozor apps
    "apps.core",
    "apps.accounts",
    "apps.places",
    "apps.presence",
    "apps.chat",
    "apps.notifications",
    "apps.publishing",
    "apps.feeds",
    "apps.projects",
    "apps.events",
    "apps.citizen",
    "apps.publishing_api",
    "apps.uploads",
    "apps.geocoding",
    "apps.admin_panel",
]

AUTH_USER_MODEL = "accounts.User"

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "apps.core.security.SecurityHeadersMiddleware",
    "apps.core.security.RateLimitMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.locale.LocaleMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "apps.accounts.middleware.ProfileLanguageMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "astrozor.urls"
WSGI_APPLICATION = "astrozor.wsgi.application"
ASGI_APPLICATION = "astrozor.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

# ---- Database ----

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("POSTGRES_DB", "astrozor"),
        "USER": env("POSTGRES_USER", "astrozor"),
        "PASSWORD": env("POSTGRES_PASSWORD", "astrozor"),
        "HOST": env("POSTGRES_HOST", "db"),
        "PORT": env("POSTGRES_PORT", "5432"),
        "CONN_MAX_AGE": 60,
    }
}

# ---- Cache / channels ----

REDIS_URL = env("REDIS_URL", "redis://redis:6379/0")

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_URL,
    }
}

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {"hosts": [REDIS_URL]},
    },
}

# ---- Celery ----

CELERY_BROKER_URL = REDIS_URL
CELERY_RESULT_BACKEND = REDIS_URL
CELERY_TASK_TIME_LIMIT = 60 * 5
CELERY_TIMEZONE = "Europe/Prague"

# ---- Auth / passwords ----

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# ---- i18n / TZ ----

LANGUAGE_CODE = "en"
LANGUAGES = [("en", "English"), ("cs", "Čeština")]
LANGUAGE_COOKIE_NAME = "astrozor_lang"
LOCALE_PATHS = [BASE_DIR / "locale"]
TIME_ZONE = "Europe/Prague"
USE_I18N = True
USE_L10N = True
USE_TZ = True

# ---- Static / media ----

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_URL = "/media/"
MEDIA_ROOT = Path(env("MEDIA_ROOT", str(BASE_DIR / "media")))
# Per-upload size limit (bytes). Stays well below the 5 GiB profile quota
# so a single malformed upload can't blow it.
ASTROZOR_MAX_UPLOAD_BYTES = int(env("ASTROZOR_MAX_UPLOAD_BYTES", str(8 * 1024 * 1024)))  # 8 MiB

# ---- Misc ----

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ---- E-mail (auth flows only — never notifications, per ADR-003) ----

EMAIL_BACKEND = env("EMAIL_BACKEND", "django.core.mail.backends.smtp.EmailBackend")
EMAIL_HOST = env("EMAIL_HOST", "mailhog")
EMAIL_PORT = int(env("EMAIL_PORT", "1025"))
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", default=False)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", "")
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", "Astrozor <noreply@astrozor.localhost>")

# Public-facing URL used in e-mail links
PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", "http://astrozor.localhost")

# ---- Sessions ----

SESSION_COOKIE_NAME = "astrozor_sessionid"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = env_bool("SESSION_COOKIE_SECURE", default=False)

# ---- Logging ----

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {
            "format": (
                '{"time":"%(asctime)s","level":"%(levelname)s",'
                '"logger":"%(name)s","message":"%(message)s"}'
            ),
        },
        "console": {
            "format": "%(asctime)s %(levelname)-7s %(name)s | %(message)s",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "console" if DEBUG else "json",
        },
    },
    "root": {"handlers": ["console"], "level": "INFO"},
}
