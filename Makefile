# Astrozor — orchestration shortcuts
# Everything runs in Docker. Nothing installed on host.
#
# Common targets:
#   make help        — list targets
#   make build       — build all images (python-base first, then services)
#   make up          — start the stack in background
#   make down        — stop & remove the stack
#   make logs        — tail logs for all services
#   make ps          — list running services
#   make smoke       — verify /api/v1/healthz responds
#   make sh-api      — open shell inside api container
#   make migrate     — run Django migrations
#   make test        — run backend + frontend tests
#   make lint        — run ruff + tsc + eslint (in containers)

PROJECT ?= astrozor
COMPOSE = docker compose -p $(PROJECT)

# Host OS detection — affects only the `prep` target below.
# Linux/macOS bind-mounts honour host file perms, so backend/entrypoint.sh
# MUST be +x on the host or `tini` exec'ing it inside the container fails
# with "Permission denied" (exit 126) → restart loop → smoke fails.
# Windows Docker Desktop ignores host perms on bind-mounts, so chmod is a
# no-op there; we skip it to keep `make up` silent and fast on Windows.
ifeq ($(OS),Windows_NT)
    HOST_OS := windows
else
    HOST_OS := $(shell uname -s | tr '[:upper:]' '[:lower:]')
endif

.PHONY: help
help:
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

.PHONY: prep
prep: ## Ensure host-side prerequisites for compose (OS-aware)
ifeq ($(HOST_OS),windows)
	@echo "prep: host=$(HOST_OS) — Docker Desktop ignores host perms, skipping chmod"
else
	@echo "prep: host=$(HOST_OS) — ensuring backend/entrypoint.sh is executable"
	@chmod +x backend/entrypoint.sh
endif

.PHONY: build
build: prep ## Build all images (python-base, api, frontend, proxy)
	$(COMPOSE) --profile build build python-base
	$(COMPOSE) build

.PHONY: up
up: prep ## Start stack in detached mode
	$(COMPOSE) up -d

.PHONY: down
down: ## Stop stack and remove containers
	$(COMPOSE) down

.PHONY: down-volumes
down-volumes: ## Stop stack AND remove volumes (destructive)
	$(COMPOSE) down -v

.PHONY: logs
logs: ## Tail logs for all services
	$(COMPOSE) logs -f --tail=100

.PHONY: ps
ps: ## List running services
	$(COMPOSE) ps

.PHONY: smoke
smoke: ## Verify health endpoint
	@echo "Waiting up to 60s for proxy..."
	@for i in $$(seq 1 60); do \
	    code=$$(curl -s -o /dev/null -w "%{http_code}" http://astrozor.localhost/api/v1/healthz || echo "000"); \
	    if [ "$$code" = "200" ]; then echo "OK ($$code)"; exit 0; fi; \
	    sleep 1; \
	done; \
	echo "FAIL — /api/v1/healthz did not return 200"; \
	$(COMPOSE) ps; \
	exit 1

.PHONY: sh-api
sh-api: ## Open shell in api container
	$(COMPOSE) exec api /bin/bash

.PHONY: sh-frontend
sh-frontend: ## Open shell in frontend container
	$(COMPOSE) exec frontend /bin/sh

.PHONY: sh-db
sh-db: ## Open psql in db container
	$(COMPOSE) exec db psql -U astrozor -d astrozor

.PHONY: migrate
migrate: ## Run Django migrations
	$(COMPOSE) exec api python manage.py migrate

.PHONY: makemigrations
makemigrations: ## Create Django migrations
	$(COMPOSE) exec api python manage.py makemigrations

.PHONY: shell
shell: ## Open Django shell
	$(COMPOSE) exec api python manage.py shell

.PHONY: superuser
superuser: ## Create Django superuser
	$(COMPOSE) exec api python manage.py createsuperuser

.PHONY: test
test: test-backend test-frontend ## Run all tests

.PHONY: test-backend
test-backend: ## Run backend tests
	$(COMPOSE) exec api pytest

.PHONY: test-frontend
test-frontend: ## Run frontend tests (none yet in Krok 0)
	@echo "Frontend tests not configured yet (Krok 1+)"

.PHONY: lint
lint: lint-backend lint-frontend ## Run all linters

.PHONY: lint-backend
lint-backend: ## Run ruff on backend
	$(COMPOSE) run --rm api ruff check .

.PHONY: lint-frontend
lint-frontend: ## Run eslint + tsc on frontend
	$(COMPOSE) run --rm frontend npm run typecheck

.PHONY: format
format: ## Format backend with ruff
	$(COMPOSE) run --rm api ruff format .

.PHONY: clean
clean: ## Remove dangling images and build cache
	docker image prune -f
	docker builder prune -f
