---
title: "Citizen Science"
section: "3. Funkce"
order: 40
icon: "🔬"
---

# Citizen Science

Sekce **Citizen Science** je portál do globální platformy [Zooniverse](https://www.zooniverse.org) — tisíce dobrovolnických vědců klasifikují obrázky, přepisují historické dokumenty, měří objekty na snímcích. Astrozor je **adresář admin-kurátorovaných Zooniverse projektů** + **vlastní sprinty** pro koordinovanou skupinovou klasifikaci.

## Hlavní obrazovka

Tři vrstvy obsahu shora dolů:

1. **GroupDashboardHero** — statistiky **Astrozor Zooniverse Group** (kolik klasifikací udělala skupina dohromady, top contributors)
2. **JoinAstrozorGroupCard** — onboarding karta s aktuálním stavem (4 stavy, viz dále)
3. **Grid featured projektů** — admin-kurátorovaných Zooniverse projektů (`is_featured = True`)
4. Pod tím **CampaignsBelow** — Astrozor in-house kampaně bez Zooniverse propojení (pokud existují)

## Onboarding — 4 stavy karty „Join Astrozor Group"

Astrozor je registrovaný jako **Group** na Zooniverse (group ID `ZOONIVERSE_GROUP_ID` env var). Klasifikace skupiny se kumulují do statistik a leaderboardů.

### Stav A — Nepřihlášený

Vidíš modrou kartu s prompt-em **„Přihlas se a pomoz nám"** + odkazem na **veřejnou stránku skupiny** na Zooniverse (členové, statistiky).

### Stav B — Přihlášen, ale ne propojen Zooniverse

Modrá karta s **„Propojit Zooniverse"** tlačítkem. Klik → OAuth flow přes `panoptes.zooniverse.org` (Settings → Propojené účty → Zooniverse, viz [Nastavení](feature-settings)).

### Stav C — Propojen, ale není členem skupiny

Modrá karta s **„Připojit ke skupině X uživatelů"** tlačítkem. Klik:

1. Otevře Zooniverse v novém tabu na `join_url` (Astrozor Group invite page)
2. Tam klikneš **Join** na Zooniverse
3. Vrátíš se zpět do Astrozor
4. Astrozor periodicky **polluje** stav členství po 30 s / 2 min / 10 min (worst-case staircase)
5. Re-check spustí i window `focus` event (když se vrátíš z taby)
6. Jakmile Zooniverse potvrdí členství, karta zezelená

### Stav D — Aktivní člen

Zelená karta `● You're a member` + link na public group page.

## Featured projekty

Grid karet vybraných adminem (`is_featured: true`). Každá karta:

- **Banner / avatar** (s telescope-emoji fallback pro chybějící obrázky)
- **Title** + owner login (`@username`)
- **Tagy**
- **Total classifications** count
- **Group contribution** count (kolik klasifikací udělala Astrozor skupina)

Klik otevře `ZooniverseProjectDetail` (URL `?p=<zooniverse_id>`).

> Adminové přidávají projekty přes **Správa → Zooniverse projekty** ([viz Administrace](feature-admin)).

## Detail projektu

Po kliknutí na kartu vidíš:

### Banner + meta

- Velký background-image banner (21:9 ratio)
- Title + owner_login
- Tlačítko **Otevřít projekt na Zooniverse** (vpravo nahoře, link)

### Hlavní obsah (levý sloupec)

- **Introduction** nebo description (whitespace-pre-wrap)
- **Zombie warning** — varovný banner pokud má projekt status „zombie" (=Zooniverse archive)
- **ClassifyButtons** — seznam workflow-ů z projektu, každý jako tlačítko:
  - Klik otevře Zooniverse classification UI pro daný workflow v novém tabu
  - Pokud nejsi přihlášen, hint pod tlačítky říká, že tě Zooniverse pustí jako anonymního uživatele (klasifikace se ale neuloží na účet)
- **SprintsSection** — chronologický list sprintů (viz dále)

### Pravá sticky aside

- **Activity sparkline** — graf klasifikací poslední 30 dní (z `projectSeries` endpointu)
- **Stats karta**:
  - Total classifications (číslo)
  - Group classifications (Astrozor skupina, indigo)
  - Project state (`live`, `paused`, atd.)
  - Primary language
- **Tags** chip list

## Sprinty

**Sprint** = časově omezené období skupinové klasifikace jednoho workflow-u v rámci projektu. Astrozor sprinty:

- Mají vlastní `slug`, title, popis
- **starts_at + ends_at** (rozsah dat) NEBO jen `starts_at` (open-ended) NEBO ani jedno (any-time)
- **Coordinator** — kdo je řídí (email + display_name)
- **Workflow** — který Zooniverse workflow se v rámci sprintu klasifikuje (`workflow_id`, `workflow_name`, `workflow_classify_url`)
- **Status** — `draft` / `live` / `archived`
- **Účastníci** — explicitní opt-in přes Join button

### Sprint detail (`SprintFullPage`)

URL `/citizen-science?p=<zid>&s=<slug>`. Layout:

- **← Back to project** + status badge
- **Title + dates + coordinator + workflow name**
- **Popis** (whitespace-pre-wrap)
- **🔭 Open workflow on Zooniverse** (CTA, otevře classification UI v novém tabu)
- **Join / Leave sprint** tlačítko
- Pokud nejsi účastník: indigo prompt karta **„👋 Připoj se k tomuto sprintu"** s vlastním Join tlačítkem
- **SprintChat** — vláknitý chat účastníků sprintu (samostatná komunikace, ne Zooniverse Talk)
- **ZooniverseTalkBrowser** — embed Zooniverse Talk fóra pro daný projekt (read přes Talk API)

## Použití — typické scénáře

### Use-case 1: Začít přispívat (první návštěva)

1. Otevři **Citizen Science** v nav
2. Vidíš onboarding kartu „Přihlas se a pomoz nám"
3. Přihlas se přes SSO (GitHub / Google / …)
4. Karta se přepne na **„Propojit Zooniverse"**
5. Klik → OAuth flow → schválit `read:profile` scope na Zooniverse
6. Karta se přepne na **„Připojit ke skupině"**
7. Klik → otevře Zooniverse v novém tabu → tam **Join**
8. Vrať se zpět → Astrozor po cca 30 s ověří členství → karta zezelená
9. Klikni na **featured projekt** → otevři **Classify** tlačítko → Zooniverse classification UI v novém tabu
10. Tvé klasifikace se kumulují do `group_contribution_count` (a tvé `ZooniverseContributor` row)

### Use-case 2: Připojit se ke sprintu

1. Otevři detail projektu (z gridu)
2. Pod ClassifyButtons je **SprintsSection** s listem aktivních sprintů
3. Klik na sprint → otevře `SprintFullPage` (URL `?s=<slug>`)
4. Klikni **Připojit se** → tvůj `Sprint.is_joined = true`
5. Tvé klasifikace v rámci `workflow_id` během `starts_at..ends_at` se počítají do sprintu
6. V SprintChat můžeš diskutovat s ostatními účastníky
7. Pro klasifikaci klik **🔭 Open workflow on Zooniverse** → Zooniverse UI

### Use-case 3: Sledovat statistiky skupiny

1. Otevři **Citizen Science**
2. Nahoře `GroupDashboardHero` ukáže:
   - Celkové klasifikace skupiny napříč všemi projekty
   - Top contributors (Astrozor users)
   - Aktivita za poslední dny
3. Pro per-projekt statistiky otevři detail projektu → pravá aside karta **Aktivita za 30 dní** (sparkline)

## In-house kampaně (CampaignsBelow)

Pod gridem Zooniverse projektů je sekce s Astrozor in-house kampaněmi (přes `CampaignsPage` komponentu). Tyto kampaně NEjsou na Zooniverse — jsou to vlastní organizované aktivity (např. „Pozorování meteorického roje").

Pole `Campaign`:
- Title, popis, methodology
- Status (`draft` / `live` / `archived`)
- Coordinator email
- Kind (`other` default)
- `contribution_schema` (JSON pro structured submissions)
- Tagy
- starts_at, ends_at

Tento blok je viditelný jen pokud aspoň jedna in-house kampaň existuje.

## Datový model

```python
class ZooniverseProject:
    zooniverse_id, slug, title, owner_login, classifications_count,
    group_contribution_count, is_featured, tags, ...

class Campaign:
    id, slug, title, description, status, coordinator_email,
    starts_at, ends_at, zooniverse_project (FK), workflow_id, workflow_name, ...
    # When zooniverse_project is set → Campaign is a "sprint"

class ZooniverseContributor:
    user (FK), zooniverse_login, classifications_count, last_seen, ...
```
