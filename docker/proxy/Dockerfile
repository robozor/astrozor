FROM caddy:2.8-alpine

COPY docker/proxy/Caddyfile /etc/caddy/Caddyfile

EXPOSE 80 443

HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=5s \
    CMD wget -qO- http://localhost/ >/dev/null 2>&1 || exit 1
