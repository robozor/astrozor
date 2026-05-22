---
title: "Projekty"
section: "3. Funkce"
order: 50
icon: "💻"
---

# Projekty

Sekce **Projekty** je adresář otevřených technických aktivit komunity — software, hardware, výzkumné repo. Každý projekt může mít napojené **GitHub repozitáře** a Astrozor je obohatí o issue tracker, assigneeship a leaderboard řešitelů.

## Hlavní obrazovka

### Hero intro (`ProjectsIntro`)

První věc na obrazovce — gradient karta s ilustrací **CollaborationIllustration** (inline SVG, žádné externí obrázky). Pitch:

- „Chceš se zapojit?"
- 3 bullety co můžeš dělat
- Bez registrace lze prohlížet, pro claim issue je nutné přihlášení

### Issue Leaderboard panel

Globální leaderboard řešitelů napříč **všemi viditelnými repozitáři projektů**. Pro každý GitHub username:

- **Avatar** + GH login (link na profil na GitHubu)
- **Počet otevřených issues** přiřazených na tohoto usera
- **Astrozor display name** vedle GH login-u (pokud uživatel má v Astrozor identitu se stejným loginem v Identity table) — formát `Robozor (robozor)`
- Sortuje desc dle počtu issues

Pokud >8 položek, **Rozbalit** tlačítko.

### Project list

Karta každého projektu:

- **Title**
- **Description** s linkify-em http(s) URL (klikatelné odkazy v plain textu, viz `linkifyText`)
- **Vlastník** + visibility badge (`public` / `members` / `private`) + status badge (pokud != `active`)
- **Členové** badge
- **Tagy**
- **Napojené GH repos** — pokud existují, ikona + počet otevřených issues

**+ Nový projekt** vpravo nahoře.

## Detail projektu

Pod top-bar (back tlačítko vlevo, Join/Leave + Edit/Delete vpravo) následuje:

### Header

- **Title** (h2)
- **Vlastník: `email`** + viditelnost badge + status badge
- Tlačítka:
  - **Připojit se** (`Join`) — anyone může (open membership, no invitation flow)
  - **Odejít** (`Leave`) — disabled pokud jsi creator (creator can't leave)
  - **✎ Upravit** — jen pokud `can_edit` (creator + Astrozor admin)
  - **Smazat** — jen pokud edit

### Description

Plain text s `linkifyText` — http/https URL se převedou na klikatelné `<a>` (target=_blank). Tečka / čárka / závorka na konci URL se neuvažuje za součást URL ("see https://x.com." → link jde na `https://x.com`).

### Členové

Sub-sekce s listem `Membership`:

- **Avatar + display name** (přes `UserNameLink` na public profil)
- **Role** badge — `OWNER` / `MAINTAINER` / `CONTRIBUTOR`
- Defaultně se vytvoří `CONTRIBUTOR` po Join; OWNER je creator (auto); MAINTAINER aktuálně jen přes Django admin / shell

### GitHub repozitáře (`RepoCard` per repo)

Pro každý napojený GitHub repo:

- **Logo + URL** (link na GitHub)
- **Metadata** — description, stars, language, default branch
- **Last release** + datum (z GH API)
- **Last commit** datum
- **🐛 Issues counter** — `X otevřených issues · + N PR` (issues a PRs separátně)
- **+ Nový issue** tlačítko — otevře modal:
  - Title, body (markdown)
  - Typ: `bug` / `feature` / `task`
  - Astrozor POST-ne na GitHub `/repos/{owner}/{name}/issues` s labelem dle typu + label `astrozor` (origin marker)
  - Po vytvoření 800ms delay + setQueryData refresh (GitHub eventual consistency workaround)

### IssuesPanel

Rozbalený seznam otevřených issues z repozu:

- **#číslo, title, labels, assignees**
- **Klik na issue** → otevře `IssueDetailPanel` (in-app)

### IssueDetailPanel

Modal s plnými detaily issue:

- Title, body (raw text z GH), labels
- **Řešitelé** (`assignees`) — list avatarů s GH logins
- Tlačítka:
  - **🙋 Vzít si na starost** — pokud nejsi assignee (přidá tě přes `POST /issues/{n}/assignees`)
  - **Připojit se k řešitelům** — pokud někdo jiný už je assignee (přidá tě jako co-assignee)
  - **✕ Nechci být řešitel** — pokud jsi sám assignee (odstraní tě přes `DELETE /issues/{n}/assignees` s body)
  - **✓ Jsi řešitel** — zelený badge, pokud jsi aktuálně assignee

Pokud claim selže s `not_collaborator`, Astrozor ti řekne, že GitHub odmítl přiřazení (musíš mít write access do repa).

## Use-case scénáře

### Use-case 1: Připojit se k projektu

1. **Projekty** v hlavní navigaci
2. Listing projektů, klik na ten, který tě zajímá
3. V detailu klikni **Připojit se** (modré tlačítko vpravo nahoře)
4. Stáváš se `CONTRIBUTOR`
5. Vidíš všechny `members` only obsah projektu (pokud má `visibility=members`)

### Use-case 2: Vzít si issue na starost

1. Detail projektu → najdi GH repo → rozklikni IssuesPanel
2. Listing otevřených issues — vidíš #číslo + title + assignees (žluté avataráče)
3. Klik na issue → `IssueDetailPanel`
4. **🙋 Vzít si na starost**
5. Astrozor POST na GitHub: tvoje GH login se přidá jako assignee
6. Po cca 1 vteřině (GH eventual consistency) panel zobrazí tvůj badge **✓ Jsi řešitel** + tlačítko **✕ Nechci být řešitel**
7. V projekt leaderboardu se ti zvýší counter

### Use-case 3: Vytvořit nový issue z Astrozoru

1. Detail projektu → RepoCard → **+ Nový issue**
2. Title: „Crash při ukládání bundle z VS Code"
3. Body (markdown): popis + steps to reproduce + expected/actual behavior
4. Typ: `bug`
5. **Vytvořit**
6. Astrozor:
   - POST `/repos/<owner>/<name>/issues` na GitHub s labels `["bug", "astrozor"]`
   - 800 ms delay (workaround GH eventual consistency u listing endpointu)
   - Refresh issue listu — nový issue se objeví
7. Open_issues counter se zvýší o 1 (atomic F-expression na backendu)

### Use-case 4: Vytvořit nový projekt

1. **Projekty → + Nový projekt**
2. Editor pole:
   - **Name** — povinný
   - **Description** — multi-line, plain text s linkify
   - **Visibility** — `public` / `members` / `private`
   - **Status** — `active` (default) / `paused` / `archived`
   - **Tagy** — autocomplete
   - **GitHub repozitáře** — multi-add (validuje URL přes GH API)
3. **Vytvořit**
4. Stáváš se `OWNER` (automaticky)

### Use-case 5: Vlastník opouští projekt

**Nelze.** Server vrátí 403. Místo toho:

1. Promote jiného člena na `MAINTAINER` (přes Django admin nebo manuálně přes API — UI flow zatím neexistuje)
2. Pak smaž celý projekt (`Delete` tlačítko vpravo nahoře)

## Co aktuálně NEEXISTUJE

- **Invitation flow** — žádné „pozvat člena", „přijmout pozvánku". Open membership: kdokoliv klikne Join.
- **UI pro role transition** — promote `CONTRIBUTOR` → `MAINTAINER` jde jen přes Django admin
- **Project chat / discussion** — komentáře na projektu jsou plánované, zatím chybí (komentáře jen u článků / akcí / kampaní)
- **Activity feed** — kdo co udělal v projektu, zatím není
- **Issue closing z Astrozoru** — pro close jdi na GitHub (Astrozor není maintainer GitHub API mutací)

## Datový model

```python
class Project:
    slug, name, description, visibility, status, tags,
    created_by, created_at, top_contributors (JSON), ...

class Membership:
    project (FK), user (FK), role (OWNER / MAINTAINER / CONTRIBUTOR),
    joined_at

class GHRepo:
    project (FK), owner, name, github_url, description, stars,
    language, default_branch, last_release_*, last_commit_at,
    open_issues, last_fetched_at, last_status, ...
```
