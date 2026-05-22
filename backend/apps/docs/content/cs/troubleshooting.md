---
title: "Diagnostika a časté problémy"
section: "4. Pokročilé"
order: 90
icon: "🔧"
---

# Diagnostika a časté problémy

Nejčastější problémy a jak je řešit. Pokud tu nenajdeš odpověď, otevři issue v repozitáři projektu Astrozor.

## Přihlášení

| Problém | Řešení |
|---|---|
| **SSO redirect padá s `oauth_error`** | Provider OAuth app nemá správnou redirect URI. Email adminovi nebo zkontroluj `.env.example` pro správnou URL. |
| **Email verifikace nedoručena** | Mrkni do spam složky. V dev módu pošta padá do **MailHog** — `http://localhost:8025`. |
| **`Account exists with different sign-in method`** | Existující účet má jiný provider. Přihlas se přes původní provider a v Settings → Propojené účty přidej nový. |

## Publikování

| Problém | Řešení |
|---|---|
| **`401 Token rejected`** | Vytvoř nový token v Settings → API tokeny |
| **`403 Token missing 'publish:articles' scope`** | Token vytvořený bez scope — vytvoř nový se zaškrtnutým `publish:articles` |
| **`400 Slug taken by another user`** | Slug zabraný jiným autorem — zvol jiný |
| **`507 Storage quota exceeded`** | Smaž starší články nebo požádej admina o navýšení (default 5 GB) |
| **`400 Archive must contain index.html at root`** | ZIP má enclosing folder — zazipuj **obsah** složky, ne ji samotnou |
| **VS Code `Could not run "quarto"`** | Nainstaluj Quarto CLI nebo nastav plnou cestu v Settings → `astrozor.quartoExecutable` |
| **Quarto render: `Specified 'language' file does not exist`** | YAML používá `language: cs` (Quarto-specific), použij `lang: cs` |

## Mapa

| Problém | Řešení |
|---|---|
| **Tiles nezobrazeny** | Síťová chyba — zkontroluj `/pmtiles/` URL ve dev tools. Možná protomaps archive ještě stahuje (admin) |
| **Markery šedé bez ikon** | Engine ikony se načítají z `/icons/`. Jednou stáhnutě, cached — zkus hard refresh (`Ctrl+F5`) |
| **Pozice mimo ČR** | Nastav pozici v profilu (Settings → Profil) |

## Akce a registrace

| Problém | Řešení |
|---|---|
| **Email s ICS nedoručen** | Mailhog v dev / spam složka v prod |
| **Nemůžu se odhlásit** | Organizátor zamkl registrace — kontaktuj ho |

## Citizen Science

| Problém | Řešení |
|---|---|
| **Zooniverse iframe nezobrazí** | Třetí strana cookies / X-Frame-Options — Zooniverse classification UI vyžaduje, abys byl přihlášený na Zooniverse |
| **Klasifikace se neobjevují na leaderboardu** | Astrozor periodicky sync-uje (default 1h). Forciuj sync v Admin panel → Zooniverse → Refresh |

## Projekty (GitHub)

| Problém | Řešení |
|---|---|
| **Issues se nezobrazují** | Repo není public, nebo GitHub PAT chybí (Admin panel) |
| **Po vytvoření issue se list neaktualizuje** | GitHub eventual consistency — refresh stránky za 1-2 vteřiny |
| **Issue counter != počet zobrazených issues** | GitHub `open_issues_count` zahrnuje PRs. Tlačítko ukazuje `X issues · + N PR` |

## Mastodon

| Problém | Řešení |
|---|---|
| **`OAuth app registration failed`** | Server nepodporuje dynamic registration (Pleroma s closed registrations) |
| **Toot neodejde, `401 Unauthorized`** | Token revoked na Mastodon side — odpoj a znovu propoj |

## Notifikace

| Problém | Řešení |
|---|---|
| **Web push nedoručen** | Browser povolení odebráno — Settings → Privacy and security → Site settings → Notifications |
| **Discord webhook test selže** | Špatná URL (chybí `/` na konci nebo token), nebo Discord smazal webhook |
| **Email reminder akce nedoručen** | Profile.notify_email vypnuté, nebo SMTP issue |

## Self-hosting

| Problém | Řešení |
|---|---|
| **API kontejner restartuje** | Mrkni `docker compose logs api` — typicky DB migration failed nebo missing env var |
| **Frontend Vite HMR neaktualizuje** | `docker compose restart frontend` |
| **`Cannot connect to PostgreSQL`** | Healthcheck databáze ještě běží, počkej 10s |
| **Caddy 502** | Backend nedosažitelný — `docker compose ps`, zkontroluj že api běží |

## Když nic nepomáhá

1. **Hard refresh** (`Ctrl+F5`) — vyloučí cache problémy
2. **Developer Tools → Console** — uvidíš JavaScript errory
3. **Developer Tools → Network** — uvidíš failing requests s response body
4. **Issue v Astrozor projektu** — pošli reprodukci, browser version, screenshot
