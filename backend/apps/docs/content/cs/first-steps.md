---
title: "První kroky"
section: "1. Začínáme"
order: 20
icon: "🚀"
---

# První kroky v Astrozoru

## 1) Účet

Klikni na **Přihlásit** vpravo nahoře. Máš dvě cesty:

- **SSO** přes GitHub, Google, GitLab nebo Discord — jeden klik a jsi přihlášený. Astrozor čte jen jméno, email, avatar — žádné repository write-access.
- **Email + heslo** — vytvoříš si lokální účet, dostaneš verifikační email, klikneš na link.

## 2) Profil

V **Nastavení** vyplň:

- **Display name** — zobrazí se vedle tvých článků a komentářů
- **Jazyk** — celé UI + výchozí jazyk článků
- **Bio** — pár vět o tobě, vidí se u profilu
- **Pozice na mapě** — můžeš vybrat přesnou polohu (sdílíš souřadnice) nebo jen kraj/město. Default je `Soukromé` (sdílíš jen kraj). Hodí se pro hledání lokálních pozorovatelů.

## 3) Propojené účty

V **Nastavení → Propojené účty** můžeš svázat **další SSO providery** se stejným Astrozor účtem (přihlas se zítra přes Google, příště přes GitHub — pořád stejný uživatel). Plus:

- **Mastodon** — pro cross-posting článků na tvůj fediverse účet
- **Zooniverse** — pro automatickou registraci na citizen-science kampaně

## 4) Notifikace

V **Nastavení → Notifikace** zapnout:

- **Web push** — browser notifikace na nové komentáře, odpovědi, registrace
- **Discord webhook** — fanout na tvůj kanál (pro skupinové projekty)
- **E-mail** — jen pro auth flows (verifikace, password reset), ne pro běžné notifikace (ADR-003 — Astrozor neposílá marketing email)

## 5) První článek

Nejjednodušší cesta:

1. **Články** → **+ Nový článek**
2. Napiš pár odstavců markdownu (živý náhled)
3. **Publikovat**

Detaily: [Publikování v Astrozoru](publish-astrozor-editor).

## 6) Pokročilejší publikace

Pro Quarto / Jupyter / RMarkdown:

- [Z Astrozoru (markdown)](publish-astrozor-editor)
- [Z VS Code](publish-vscode)
- [Z RStudia](publish-rstudio)
- [Z Jupyter](publish-jupyter)

## 7) Komunita

Projdi si:

- **Mapa** — vidíš lokální hvězdárny a stanoviště, jejich kvalitu oblohy, světelné znečištění
- **Akce** — kdo organizuje co tento týden / měsíc
- **Citizen Science** — kampaně, na které se můžeš zapojit (klasifikace dat na Zooniverse)
- **Projekty** — software, hardware, výzkumné projekty s otevřenými issues, kterým můžeš pomoct

## Tipy

- **Klávesové zkratky** — v editoru `Ctrl+B` bold, `Ctrl+I` italic, `Ctrl+K` link
- **Filtrování po tagu** — klikni na tag pod článkem; filtruje listing
- **Hledání** — vyhledávání článků podle textu (zatím v základní verzi, FTS přijde)
- **Browse anonymně** — vlastní obsah neuvidíš, ale Mapa + veřejné Články + Akce ti jsou přístupné i bez přihlášení
