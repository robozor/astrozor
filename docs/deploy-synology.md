# Astrozor — Synology NAS deployment

Tento návod popisuje, jak nasadit Astrozor stack na Synology NAS s
Container Manager (DSM 7.2+).

> **Co budeš potřebovat:** Synology NAS s podporou Container Manager
> (Docker), SSH přístup, minimálně 4 GB RAM a 20 GB volného místa.
> Doporučujeme x86_64 modely (DS920+, DS1522+, DS923+); ARM modely
> (DS220j, DS118) sice fungují, ale jsou pomalé.

---

## 1) Co se v Astrozoru pouští

Astrozor je multi-container stack. Tagged release v1.2.0+ má všechny
hlavní images publikované v GHCR — můžeš je rovnou pullnout, nic
nebuildíš lokálně:

| Image | Účel |
|---|---|
| `ghcr.io/robozor/astrozor-api` | Django + Ninja API (slouží jako worker + beat) |
| `ghcr.io/robozor/astrozor-frontend` | nginx + Vite statický build SPA |
| `ghcr.io/robozor/astrozor-proxy` | Caddy reverse proxy |
| `postgis/postgis:16-3.4-alpine` | databáze |
| `redis:7-alpine` | cache + Celery broker |

---

## 2) Příprava

### 2.1 Container Manager

V DSM otevři **Package Center → Container Manager** a nainstaluj
(je-li potřeba). Spusť ho a ujisti se, že tvůj uživatel je v
administrátorské skupině.

### 2.2 SSH

V **Control Panel → Terminal & SNMP** zapni SSH.

```bash
ssh admin@<NAS-IP>
```

Pokud DSM nepoužíváš s root, většinu příkazů musíš spouštět
přes `sudo`.

### 2.3 Datový adresář

```bash
sudo mkdir -p /volume1/docker/astrozor
sudo chown $(whoami) /volume1/docker/astrozor
cd /volume1/docker/astrozor
```

---

## 3) Konfigurace

### 3.1 Stažení compose souboru

Stáhni si `docker-compose.prod.yml` a `.env.example` z GitHubu — nemusíš
klonovat celý repo:

```bash
curl -fL https://raw.githubusercontent.com/robozor/astrozor/v1.2.0/docker-compose.prod.yml -o docker-compose.yml
curl -fL https://raw.githubusercontent.com/robozor/astrozor/v1.2.0/.env.example -o .env
```

### 3.2 Úprava `.env`

Otevři `.env` a nastav minimálně tyto proměnné:

```bash
# povinné
DJANGO_SECRET_KEY=<vygeneruj náhodný řetězec, např. `openssl rand -hex 32`>
POSTGRES_PASSWORD=<silné heslo>
ASTROZOR_DOMAIN=astrozor.tvoje-domena.cz   # nebo nas-ip pro lokální test

# release tag — co se má pullovat
ASTROZOR_TAG=v1.2.0
ASTROZOR_IMAGE_OWNER=robozor

# Caddy site address — viz sekce 4
SITE_ADDRESS=:80

# časová zóna
TZ=Europe/Prague

# pokud chceš e-maily (reset hesla, atd.) — jinak nech prázdné
EMAIL_HOST=smtp.tvoje-domena.cz
EMAIL_PORT=587
EMAIL_HOST_USER=...
EMAIL_HOST_PASSWORD=...
EMAIL_USE_TLS=true
DEFAULT_FROM_EMAIL=noreply@tvoje-domena.cz

# OAuth providery — nech prázdné, pokud nepotřebuješ
GITHUB_OAUTH_CLIENT_ID=
GITHUB_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
```

> **Generování silného secret keye:**
> ```bash
> openssl rand -hex 32
> ```

---

## 4) Reverse proxy & TLS — tři varianty

Synology už má vlastní reverse proxy v DSM. Vyber si jednu:

### A) DSM reverse-proxy + Astrozor jen na HTTP (doporučeno)

DSM ukončuje TLS, Astrozor jede na lokálním portu (např. 8081), bez
HTTPS uvnitř.

V `.env`:
```bash
SITE_ADDRESS=:80
ASTROZOR_HTTP_PORT=8081
ASTROZOR_HTTPS_PORT=8443   # nepoužije se, ale port musí být volný
```

V DSM **Control Panel → Login Portal → Advanced → Reverse Proxy**
přidej pravidlo:
- **Source**: `astrozor.tvoje-domena.cz`, HTTPS, 443
- **Destination**: `localhost`, HTTP, 8081
- Custom Headers: `WebSocket` (pro Channels/HMR), `X-Forwarded-For`

DSM se postará o Let's Encrypt cert v
**Control Panel → Security → Certificate**.

### B) Caddy ukončuje TLS přímo (potřebuje volný port 443)

Tohle funguje jen pokud na NAS port 443 nepoužívá nic jiného. DSM
defaultně používá 5001 pro HTTPS, takže port 443 by mohl být volný —
ale ověř si.

V `.env`:
```bash
SITE_ADDRESS=astrozor.tvoje-domena.cz
ASTROZOR_HTTP_PORT=80
ASTROZOR_HTTPS_PORT=443
```

Caddy automaticky vyřídí Let's Encrypt. Doména musí ukazovat na IP NAS
a port 80 + 443 musí být dosažitelný z internetu (forwarding na
routeru).

### C) Jen lokální přístup po IP (testovací)

V `.env`:
```bash
SITE_ADDRESS=:80
ASTROZOR_HTTP_PORT=8081
ASTROZOR_DOMAIN=192.168.1.50    # IP NAS
PUBLIC_BASE_URL=http://192.168.1.50:8081
DJANGO_CSRF_TRUSTED_ORIGINS=http://192.168.1.50:8081
```

Po startu klikni v prohlížeči na `http://192.168.1.50:8081`.

---

## 5) Start stacku

```bash
docker compose pull
docker compose up -d
```

První pull stáhne ~1 GB, build krok není potřeba.

Sleduj logy během prvního startu (api dělá migrace + collectstatic):

```bash
docker compose logs -f api
```

Až uvidíš `Starting gunicorn`, je hotovo. Ověř:

```bash
curl -fsS http://localhost:8081/api/v1/healthz
# → {"status":"ok",...}
```

---

## 6) Vytvoření admin uživatele

```bash
docker compose exec api python manage.py createsuperuser
```

Pak se přihlas na `https://astrozor.tvoje-domena.cz/` — admin panel
najdeš v UI (ozubené kolo → **Administrace**). Astrozor používá vlastní
produktový admin nad `/api/v1/admin/*`; nativní `/admin/` (Django) není
exponovaný — viz [ADR-008](./decisions/ADR-008-disable-django-admin.md).

---

## 7) Upgrade na novější verzi

```bash
cd /volume1/docker/astrozor

# uprav .env: ASTROZOR_TAG=v1.3.0 (nebo cokoli novějšího)
nano .env

# stáhni nový compose pro případ, že se změnil layout
curl -fL https://raw.githubusercontent.com/robozor/astrozor/v1.3.0/docker-compose.prod.yml -o docker-compose.yml

docker compose pull
docker compose up -d   # spustí jen ty, co se změnily
```

Migrace se aplikují automaticky při startu kontejneru api
(viz `entrypoint.sh`).

---

## 8) Backupy

Co je důležité zálohovat:

| Volume | Co obsahuje |
|---|---|
| `astrozor_db_data` | PostgreSQL databáze (uživatelé, články, místa, ...) |
| `astrozor_media` | nahrané obrázky, rendrované Quarto/RMarkdown bundly |
| `astrozor_pmtiles` | PMTiles dlaždice (lze obnovit re-importem) |
| `astrozor_light_pollution` | LP dlaždice (lze obnovit re-importem) |
| `astrozor_caddy_data` | Let's Encrypt certifikáty |

Synology Hyper Backup umí zálohovat Docker volumes přímo. Cesta:
`/volume1/@docker/volumes/`.

Manuální dump databáze:

```bash
docker compose exec db pg_dump -U astrozor astrozor | gzip > backup-$(date +%F).sql.gz
```

---

## 9) Troubleshooting

**`docker compose pull` selhává na "denied"**

Image jsou veřejné, ale občas GHCR má rate-limit. Přihlas se anonymně:
```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u <github-user> --password-stdin
```
(Token nemusí mít žádné scope; stačí klasický PAT s prázdnými právy.)

**`api` se restartuje s `psycopg.OperationalError: connection refused`**

DB nestihla nastartovat. Počkej minutu a sleduj `docker compose logs db`.
Pokud problém přetrvává, ověř `POSTGRES_PASSWORD` v `.env`.

**Stránka načítá, ale `/api/v1/*` vrací 502**

Caddy nezvládl reverse-proxy na api. Zkontroluj:
```bash
docker compose logs proxy | tail -30
docker compose logs api | tail -30
```
Nejčastější příčina: `api` ještě běží collectstatic (chvilku to trvá).

**Frontend načte, ale tlačítka neexistují / 404 na `/assets/*.js`**

`astrozor_static` volume je prázdný. Vyřeš:
```bash
docker compose exec api python manage.py collectstatic --noinput
```

**Z DSM Container Manager UI mi to nefunguje**

Container Manager občas přepisuje labels v compose souboru a špatně
zpracovává YAML anchors (`*api-image`). Doporučujeme používat čistě
SSH + `docker compose` CLI, ne DSM UI.

---

## 10) Co dělat s addins (RStudio + VS Code)?

Pro většinu nasazení **netřeba**: addins se stahují z hlavní instance
`astrozor.cz`. Pokud chceš self-hostovat:

1. Naklonuj si repo: `git clone https://github.com/robozor/astrozor.git`
2. Spusť one-shot buildery:
   ```bash
   cd astrozor
   docker compose --profile build run --rm r-pkg-builder
   docker compose --profile build run --rm vsce-pkg-builder
   ```
3. Volumes `astrozor_r_repo` a `astrozor_vsce_repo` jsou sdílené s
   prod stackem, takže artefakty se objeví na `/R/*` a `/vscode-extension/*`
   automaticky.

---

## Reference

- GHCR registry: <https://github.com/robozor?tab=packages>
- Repo: <https://github.com/robozor/astrozor>
- Changelog: [`CHANGELOG.md`](../CHANGELOG.md)
