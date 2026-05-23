---
title: "Administrace"
section: "3. Funkce"
order: 80
icon: "🛡"
---

# Administrace (Správa)

Sekce **Správa** je dostupná **jen pro staff uživatele** (`User.is_staff = True`). Anon a běžní uživatelé tlačítko **Správa** v hlavičce nevidí; navigace na /admin v UI skončí na banneru „Tato sekce není dostupná".

Astrozor admin panel je rozdělený do **4 sekcí**. (Nativní Django admin na `/admin/` není vystavený — viz [ADR-008](https://github.com/robozor/astrozor/blob/main/docs/decisions/ADR-008-disable-django-admin.md).)

## 1) Uživatelé

Tabulka všech registrovaných uživatelů. Sloupce:

| Sloupec | Co ukazuje |
|---|---|
| **Uživatel** | email + display name |
| **Registrace** | datum signup-u |
| **Poslední přihlášení** | datum + čas (lokální format) |
| **Původ (IP / lokace)** | IP + zem + město (geo-IP lookup) + vlajka |
| **Storage** | aktuální `storage_used_bytes` / `storage_quota_bytes` |
| **Role** | toggle **+ admin** / **− admin** (is_staff) |
| **Stav** | toggle **Zablokovat** / **Odblokovat** (is_active) |

V horní liště **vyhledávání podle emailu / jména**.

### Use-case: Najít a zablokovat spammera

1. Otevři **Správa**
2. V sekci **Uživatelé** napiš část emailu nebo jména do vyhledávacího pole
3. Tabulka se filtruje real-time (deferred query)
4. Najdi řádek → klik na **Zablokovat** ve sloupci Stav
5. `is_active = False` → uživatel se nemůže přihlásit (login flow odmítne)
6. Jeho obsah (články, komentáře, registrace) zůstávají — soft block, ne delete
7. Pro úplné smazání (hard delete): `docker compose exec api python manage.py shell -c "from django.contrib.auth import get_user_model; get_user_model().objects.filter(email='...').delete()"`

### Use-case: Povýšit někoho na admina

1. **Uživatelé** → vyhledej daného člověka
2. Klik **+ admin** → `is_staff = True`
3. Od teď uvidí nav tab **Správa** a má přístup k tomuto panelu
4. Pro úplná superuser práva (přístup z `manage.py shell`, ne přes web): `manage.py shell` → `u.is_superuser = True; u.save()`

> **Pozor:** Sebe nelze degradovat (`isMe` flag chrání před lockout-em).

## 2) Místa

Komponenta **AdminPlacesPanel** — správa míst, která jsou na mapě.

### Akce

- **Vytvořit místo** (`+ Nové místo`) — formulář s polem pro:
  - Title, popis
  - Coordinates (lat/lon přes mini-mapu nebo manuálně)
  - Bortle scale + SQM (kvalita oblohy)
  - Kind (`observatory_public` / `observatory_private` / `spot_permanent` / `spot_temporary`)
  - Provozovatel, kontakt
- **Editovat** existující místa
- **Smazat** místo (pozor — odstraní i jeho check-iny, subscriptions, chat)
- **Sloučit duplicity** (pokud uživatel vytvořil duplikát)

### Use-case: Přidat novou veřejnou hvězdárnu

1. **Správa → Místa → + Nové místo**
2. Title: „Hvězdárna Karlovy Vary"
3. Souřadnice: klik na mapu nebo zadej lat/lon ručně
4. Kind: `observatory_public`
5. Bortle: odhad podle VIIRS overlay (např. 5)
6. SQM: pokud znáš (např. 19.5 mag/arcsec²)
7. Provozovatel + kontakt (volitelné)
8. **Uložit**

Místo se hned objeví na mapě se správnou ikonou (kupole se štěrbinou pro `observatory_public`).

## 3) Zooniverse projekty

Správa propojení s [Zooniverse](https://www.zooniverse.org) — Astrozor je portál do citizen-science kampaní.

### Featury

- **Vyhledávání** Zooniverse projektů — search-as-you-type přes Panoptes API
- **Tag filter** — default `astronomy`, můžeš změnit (`physics`, `space,nature`, prázdné = vše)
- **Add** — propojí projekt s Astrozor jako `ZooniverseProject` row v DB
- **Patch** — toggle `is_featured` (projekt se ukáže na top citizen science page) + úprava tagů
- **Remove (disconnect)** — odpojí projekt, smaže lokální sprinty, participants, snapshots (kaskáda s počtem v notifikaci)

### Use-case: Přidat nový Zooniverse projekt

1. **Správa → Zooniverse projekty**
2. Do search pole napiš „galaxy" nebo „supernova"
3. Tag filtr defaultní `astronomy` ti omezí na astronomické projekty
4. Vidíš seznam — Astrozor zobrazí avatar, title, classifications count
5. U projektu, který chceš přidat, klikni **Přidat**
6. Otevře se review modal s plnou metadata-preview
7. **Potvrdit** → projekt se uloží lokálně
8. Od teď ho uživatelé vidí v sekci [Citizen Science](feature-citizen-science)

### Use-case: Odpojit projekt

1. **Správa → Zooniverse projekty** → najdi projekt
2. Klik na **Disconnect**
3. Modal varuje, kolik **sprintů, participants, snapshots** se smaže
4. **Potvrdit** → projekt + cascade-data zmizí
5. Flash banner: „Odpojen X projekt — Y sprintů, Z snapshots smazáno"

## 4) Mapová infrastruktura

Nejtechničtější panel — správa self-hostovaných tile datasets a geocoderu.

### PMTiles karta

**Self-hostované vektorové tile pro celou mapu** (Protomaps formát, ~130 GB pro svět).

- **Status**: idle / running / error
- **Last update**: datum poslední úspěšné aktualizace
- **Size**: aktuální velikost archive
- **Tlačítko Stáhnout / Aktualizovat** — pustí background job (uvidíš live progress každých 1.5s)

### Photon karta (geocoder)

**Self-hostovaný OpenStreetMap geocoder** pro `apps.geocoding` (search v lokalitě users a placech).

- **Status**: idle / running / error
- **Phase**: downloading / extracting / ready
- **Country**: default `cz` (env `COUNTRY_CODE`)
- **Tlačítko Pull data** — stáhne aktuální dump

### Light Pollution karta

**Mapový overlay světelného znečištění**.

- **Source switcher** — `viirs_dnb_latest` (NOAA aktuální) vs `black_marble_2016` (NASA historická)
- **Tile count** + size — kolik dlaždic je staženo
- **Tlačítko Refresh latest** — re-fetch nejnovější VIIRS data

### Chat settings

- **Maximální délka chat zprávy** — slider 200–50 000 znaků
- Default 4000

### Use-case: Stáhnout nejnovější Light Pollution

1. **Správa → Light Pollution karta**
2. **Source**: zvol `viirs_dnb_latest` (aktuální měsíční data z NOAA)
3. Klik **Refresh latest**
4. Background job stáhne nový dataset (~hodina)
5. UI sleduje progres živě (refresh 1.5s)
6. Po dokončení se overlay na hlavní mapě automaticky aktualizuje

> **Pozor**: nerestartuj api kontejner během běžícího stahování — přeruší se to.

## 5) Pokročilé úlohy (shell)

Nativní Django admin na `/admin/` **není vystavený** (viz [ADR-008](https://github.com/robozor/astrozor/blob/main/docs/decisions/ADR-008-disable-django-admin.md)). Raw DB inspekce a operace mimo rozsah produkčního adminu se dělají přes Django shell:

```bash
docker compose -p astrozor exec api python manage.py shell
```

Z shellu máš plný ORM přístup ke všem modelům. Pro masivní změny použij `manage.py` commandy (validace, transakce).

## Logy a monitoring

V API kontejneru:

```bash
docker compose -p astrozor logs -f api
docker compose -p astrozor logs -f worker  # Celery jobs (Zenodo, Discord dispatch, …)
```

Health endpoint: `GET /api/v1/health` (vrátí 200 OK pokud DB + Redis fungují).

## Best practices pro adminy

1. **Pro masivní změny dat preferuj management commands nebo Astrozor admin panel** (víc validace než holý shell)
2. **Místa**: před smazáním zkontroluj, jestli má check-iny / subscriptions / chat
3. **Zooniverse**: disconnect je destruktivní — sprinty se kaskádově smažou
4. **PMTiles / Light Pollution download**: spouštěj v off-peak hours, traffic-heavy job
5. **User blocking**: dej přednost soft-blocku (`is_active=False`) před delete — content uživatele zůstává citovatelný
