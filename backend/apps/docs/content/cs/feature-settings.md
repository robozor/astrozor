---
title: "Nastavení"
section: "3. Funkce"
order: 60
icon: "⚙"
---

# Nastavení

Sekce **Nastavení** je rozdělená do 7 karet. Každá je samostatná `<section>` s vlastním uložením.

## 1) Ověření e-mailu

První karta `EmailVerificationCard`:

- Pokud `email_verified = false`: žluté upozornění + tlačítko **Poslat verifikační e-mail znovu**
- Po ověření: zelený text **✓ E-mail ověřen**

E-mail musíš mít ověřený abys mohl/a publikovat články + organizovat akce.

## 2) Profil

Hlavní karta `ProfileSection` obsahuje 4 sub-sekce:

### Základní pole

- **Přezdívka** (`display_name`)
- **Klub / hvězdárna** (`club`)
- **O mně** (`bio`) — textarea
- **Vybavení** (`equipment`) — textarea, free-form (např. „Newton 200/1000, ASI 533MC")
- **Preferovaný jazyk** — `cs` / `en` (po uložení se UI okamžitě přepne)

### Moje poloha (`LocationPicker`)

- **Popisek lokality** (`location_label`) — textový input
- **🔍 Vyhledat** — tlačítko vedle, klik geocoduje popisek přes interní Photon (vrátí top 5 návrhů). Klik na návrh vyplní `lat/lon` + zpřesní `location_label`
- **📍 Detekovat z prohlížeče** — `navigator.geolocation.getCurrentPosition()` (vyžaduje permission prompt)
- **Zobrazení souřadnic** — pod inputem `📍 50.08340, 14.44000` (nebo „Souřadnice nenastaveny — region mód sdílí jen popisek")
- **Smazat souřadnice** — link vpravo (jen pokud souřadnice jsou)
- **Viditelnost polohy** (`location_visibility`):
  - `precise` — sdílím přesné GPS + popisek (default)
  - `region` — sdílím jen popisek (např. „Praha"), souřadnice zůstávají soukromé
  - `hidden` — nezveřejňuji vůbec
- Hint pod selectem vysvětluje, co se v daném módu sdílí

### Časové zóny

- **Moje časová zóna** (`timezone_name`) — IANA TZ picker (komplet přes `Intl.supportedValuesOf("timeZone")`)
- Tři checkboxy ovládají `TimeDisplay` komponent všude v aplikaci:
  - **Zobrazovat UTC**
  - **Zobrazovat místní čas** (dle GPS místa / akce)
  - **Zobrazovat můj čas** (dle profilu)

Defaultně všechny on — uvidíš trojici časů u akcí a článků. Vypnutí jednoho zúží zobrazení.

### Použití — nastavit pozici

**Use-case: Astrozor sleduje mojí oblastní polohu, ne přesné souřadnice:**

1. Vlož do **Popisek lokality**: „Olomouc"
2. Klikni **🔍 Vyhledat**
3. Vyber návrh „Olomouc, Olomoucký kraj, Česko" → `lat/lon` se vyplní auto
4. Změň **Viditelnost** na `region`
5. **Uložit**

Od teď ostatní uživatelé na profilu vidí jen „Olomouc", ne přesné souřadnice. Mapa tě ani neukáže.

**Use-case: Sdílet přesnou polohu pro lokální pozorovatele:**

1. Klikni **📍 Detekovat z prohlížeče** → browser povolí → souřadnice se naplní
2. Volitelně dopiš **Popisek lokality** ručně („Můj balkon na Smíchově")
3. **Viditelnost**: `precise`
4. **Uložit**

Tvoje pozice se zobrazí na mapě jako marker (kdyby implementováno; aktuálně jen v `location_label` na public profilu).

## 3) Propojené účty

Karta `ConnectedAccounts` — list všech OAuth identit napojených na účet. Pro každý provider:

- **Zelená tečka + brand jméno** — provider je propojený
- **Display name z provideru** (např. „Robozor" z GitHub)
- **Odpojit** — odstraní identity row (server kontroluje, že zbyde aspoň jedna auth metoda — nelze ostat bez možnosti přihlášení)

Pro nepropojený provider: button **+ Propojit GitHub** atd. — spustí OAuth flow.

### Podporované providery

| Provider | Scopes | URL |
|---|---|---|
| **GitHub** | `read:user`, `user:email` | github.com/settings/developers |
| **Google** | `openid`, `email`, `profile` | console.cloud.google.com |
| **GitLab** | `read_user` (configurable instance přes `GITLAB_OAUTH_BASE_URL`) | gitlab.com (or self-hosted) |
| **Discord** | `identify`, `email`, plus volitelný bot install scope | discord.com/developers/applications |
| **Zooniverse** | `read:profile` | panoptes.zooniverse.org |
| **Mastodon** | `write:statuses`, `read:accounts` (dynamic OAuth app per instance) | tvoje instance |

Detaily setup providerů — viz `.env.example` nebo [Administrace](feature-admin).

### Use-case: Pre-existing account, přidat druhý SSO

1. Jsi přihlášený přes GitHub (původní SSO)
2. **Nastavení → Propojené účty → + Propojit Google**
3. OAuth flow přes Google
4. Google email se MUSÍ shodovat s tvým Astrozor emailem (jinak server odmítne propojit jako protection proti account-takeover)
5. Identity se uloží — od teď se můžeš přihlásit přes GitHub NEBO Google

## 4) Integrace (per-user)

Karta `IntegrationsSection` — externí služby:

### Discord webhook URL

Per-user kanál pro Discord notifikace. Formát URL `https://discord.com/api/webhooks/<id>/<token>`. Klik **Uložit** validuje a uloží.

→ Detaily v [Notifikace](feature-notifications).

### Zenodo API token

Per-user Zenodo token (pokud chceš články mintovat na **svůj Zenodo účet**, ne na platform-wide sandbox):

- **Vlož token** (password-style field — server token zobrazí jen jako `(uloženo)`)
- **Použít Zenodo sandbox** checkbox — pro testování (sandbox.zenodo.org, ne reálné DOI)
- Link na vygenerování tokenu (sandbox.zenodo.org/account/settings/applications/tokens/new pro sandbox, zenodo.org/... pro produkci)
- **Smazat token** — vymaže

### Mastodon — automatický cross-post

- **Automaticky postnout check-in na můj Mastodon** (`mastodon_autopost_checkin`) — checkbox
- Při zapnutí: kdykoli se check-in neš na hvězdárně/stanovišti, Astrozor pošle status „🔭 Pozoruji z X" na tvoji propojenou Mastodon instanci
- Vyžaduje propojený Mastodon účet (viz Propojené účty)
- Anonymní check-iny se nikdy nepostují

## 5) Discord notifikace — typy událostí

Karta `DiscordPrefsSection` — per-event-kind opt-in s filters:

- Seznam 6 typů událostí (place_followed_checkin, place_any_checkin, article_published, event_status_changed, project_lifecycle, campaign_status_changed)
- Pro každý: checkbox **Enabled**
- Pro některé: dodatečné filter pole (`author_emails`, `event_slugs`, `to_states`, `actions`, …)

Detail logiky → [Notifikace](feature-notifications).

## 6) API tokeny

Karta `ApiTokensSection` — správa personal access tokens pro publikování zvenčí:

- **Input** pro název tokenu (např. „RStudio na laptopu")
- **Vytvořit** — vygeneruje token `ast_<base64>`, **zobrazí ho JEN JEDNOU** v zelené kartě s tlačítkem **Kopírovat**
- **Seznam existujících tokens**:
  - Název
  - Prefix (`ast_xxxx…`) — first 8 chars
  - Vytvořeno / posledně použito (auto-update při každém request)
  - **Zrušit** tlačítko

Detaily v [API tokeny](api-tokens).

## 7) Storage

Karta `StorageSection`:

- **Progress bar** (indigo) — `storage_used_bytes / storage_quota_bytes`
- Číselný overview: `30.2 MB / 5 GB`
- Bez akcí (read-only stat)

Storage čerpá:
- Cover obrázky článků (server resize na 1600px)
- Quarto/RMarkdown/Jupyter bundles (extrahované HTML + assets)
- Avatary, attachments v chatu, … (cokoliv co užívá `apps.uploads`)

Pro navýšení kvóty: kontaktuj admina (nebo `python manage.py shell` → `user.profile.storage_quota_bytes = 10 * 1024**3`).

## Co aktuálně NEEXISTUJE

Pro úplnost (a aby to v docs nezavádělo):

- **Avatar upload** — avatar přichází z OAuth identity (první propojený provider). Vlastní upload zatím není.
- **Smazat účet** UI — pro úplné smazání jdi do Django admin (nebo si požádej admina). Soft block je `is_active=False`.
- **Email visibility toggle** — `email` je vždy private (vidí jen ty + admin). Public profile ho neukáže.
- **Bio markdown** — `bio` je plain text, ne markdown.
- **Test Discord webhook** tlačítko — manuálně si vyvolaj událost (check-in na sledovaném místě atd.)
