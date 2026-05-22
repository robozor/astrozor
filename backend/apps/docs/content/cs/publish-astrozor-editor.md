---
title: "Publikování v Astrozoru (in-app editor)"
section: "2. Publikování"
order: 20
icon: "✍"
---

# Publikování přímo v Astrozoru

Pro krátké texty, blogové zápisky a poznámky nemusíš nic instalovat — Astrozor má vestavěný **markdown editor** s živým náhledem.

## Postup

1. Klikni na **Články** v hlavní navigaci
2. Vlevo nahoře najdeš tlačítko **+ Nový článek**
3. Vyplň:
   - **Název** — povinný, 2 až 200 znaků
   - **Krátký popis** (summary) — zobrazí se v listingu, volitelný
   - **Jazyk** — `cs` / `en`
   - **Tagy** — pro vyhledávání a filtraci
   - **Licence** — default `CC BY 4.0`
   - **Viditelnost** — `Veřejné` (default) / `Jen pro členy` / `Soukromé`
4. Napiš obsah v markdownu v levém panelu — pravý panel ukazuje **živý náhled**
5. **Publikovat**

Článek dostane DOI přes Zenodo a uloží se s `published_via="astrozor"`.

## Markdown features

Editor podporuje GFM (GitHub Flavored Markdown):

- Headings (`# H1`, `## H2`, …)
- **Bold**, _italic_, ~~strikethrough~~, `inline code`
- Listy a vnořené listy
- Number listy
- Task listy: `- [x] hotovo`, `- [ ] todo`
- Bloky kódu se syntax highlighting (` ```python `)
- Tabulky
- Odkazy a obrázky
- Blockquotes
- Horizontální čáry
- MathJax (LaTeX vzorce v `$...$` a `$$...$$`)

Server projde markdown přes `markdown-it` + `bleach` sanitization — `<script>`, inline event handlery a další nebezpečný HTML se striknou.

## Obrázky

V editoru je tlačítko **📷 Upload obrázek**. Soubor se uloží na server pod `/media/uploads/<user_id>/<file>` a do markdownu se vloží odkaz `![alt](URL)`. Max velikost 8 MiB na soubor, kvóta 5 GB na uživatele.

## Tagy

Začni psát do tag pole a editor ti nabídne **existující tagy** z celé aplikace (články + akce + projekty + kampaně). Pokud žádný nepasuje, můžeš vytvořit nový.

## Šablony

Pro inspiraci se podívej na ukázkové články v sekci **Články** — každý je publikovaný jinou cestou, ale Astrozor markdown editor je první z nich.

## Úpravy po publikaci

1. Otevři článek v listingu
2. V toolbar vpravo nahoře klikni **✎ Upravit**
3. Edituj v markdown editoru
4. **Uložit**

Stejný slug → stejný článek. DOI zůstává, komentáře taky.

## Komentáře

Pod každým článkem je **komentářový strom** — uživatelé můžou diskutovat, odpovídat si vzájemně (threaded). Komentáře hned visí pod článkem; nepřesouvají se do jiného okna.

## Sdílení na Mastodon

Po publikaci se v hlavičce článku objeví tlačítko **🐘 Sdílet na Mastodon**. Otevře dialog s předvyplněným toot — `title + URL + tagy` — a podle tvého nastavení (Settings → Mastodon) toot publikuje na tvém propojeném účtu.

## Diagnostika

| Problém | Řešení |
|---|---|
| **Publikovat** je šedé | Vyplň povinný název (min 2 znaky) |
| `415 Unsupported Media Type` při upload obrázku | Soubor není obrázek nebo je nad 8 MiB |
| `Quota exceeded` | Smaž starší obrázky / články v Settings |
| Náhled nezobrazuje vzorce | Refresh stránky — MathJax se inicializuje při načtení |
