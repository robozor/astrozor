---
title: "Články"
section: "3. Funkce"
order: 20
icon: "📰"
---

# Články

Sekce **Články** je hlavní publikační prostor — markdown texty, interaktivní Quarto/RMarkdown bundle, Jupyter notebooky. Vědecké články s DOI, komentáři, sdílením na Mastodon.

## Hlavní obrazovka

Levý sloupec obsahuje:

- **+ Nový článek** + **Importovat Quarto** tlačítka (jen pro přihlášené)
- **Filtr podle tagů** (`TagFilter`) — multi-select chip filtr
- **Filtr podle jazyka** — `Vše` / `cs` / `en` (default = jazyk z profilu)
- **HeroCard** — největší, magazínový styl, nejnovější článek + cover obrázek + perex (16:9 mobile, sidebar 280px desktop)
- **Grid karet** (3-sloupcový na desktopu) ostatních článků

Pravý sloupec (na desktopu, lg+): **`MastodonRail`** — feed komunitního Mastodonu (viz [Mastodon](mastodon-crossposting)).

Na mobilu jsou levý/pravý sloupec na samostatných tabech (Články ↔ Mastodon).

## Karta článku

Každá karta v gridu / hero obsahuje:

- **Cover obrázek** — `article.cover_image_url` nebo generovaný gradient fallback (z hash slugu) ve formátu 16:9
- **Engine badge** vlevo dole na coveru — markdown / quarto / rmarkdown / jupyter (oficiální brand ikona v barevném čtverečku)
- **Featured badge** (jen v HeroCard) — indigo plnoplošný label, pokud `article.featured = true`
- **Members-only badge** vpravo nahoře (žlutý zámek) — pokud `visibility=members`
- **Engine label** + jazyk + reading minutes („5 min čtení")
- **Title** (text-xl pro hero, text-base pro grid)
- **Summary** (line-clamp-2 pro grid, line-clamp-4 pro hero)
- **Autor** (přes `UserNameLink` — klik otevře public profil) + datum + DOI (pokud má)
- **Tagy** chip list (xs velikost)

## Detail článku

URL `/articles?a=<slug>` (SPA deep-link) nebo `/clanky/<slug>` (server-rendered SEO redirect).

### Layout

1. **Top toolbar**:
   - **← Zpět na seznam** (vlevo)
   - **🐘 Sdílet na Mastodon** (vpravo) — jen u publikovaných článků
   - **✎ Upravit** (vpravo) — jen pro autora článku
2. **Cover obrázek** (volitelný) — pokud má článek `cover_image_url`, zobrazí se v centrovaném boxu s `max-h-72/80`, `object-contain` (nikdy ořez)
3. **Header**:
   - **Title** (h2, semibold)
   - **Autor / datum / jazyk / licence / DOI** (xs řádek pod title-em)
4. **Tělo článku**:
   - **Markdown engine** → vyrenderované HTML z `content_html`, stylové přes `.article-html`
   - **Quarto/RMarkdown/Jupyter engine** → `QuartoIframe` s `asset_url` (auto-resize iframe)
5. **Komentáře** — `ThreadedDiscussion` (viz dále)

### Cover image rendering — pravidla

| Místo | Object-fit | Důvod |
|---|---|---|
| **HeroCard** | `object-cover` (16:9 + min-h 180-260px desktop) | Magazínový styl, uniform grid |
| **ArticleCard** | `object-cover` (16:9) | Uniform grid v listingu |
| **Detail** | `object-contain` (max-h-72/80, justify-center) | Plný obrázek bez ořezu — 800×600 zůstane celé |

Pokud článek nemá `cover_image_url`, list karty zobrazí **gradient fallback** (HSL z hash slugu) — barevný čtvereček s hvězdičkou. Detail v takovém případě **žádný banner nezobrazuje** (jdeme rovnou na title).

## Editor článku

Otevíraný přes **+ Nový článek** nebo **✎ Upravit**. Pole:

- **Title** — povinný, 2-200 znaků
- **Summary** — krátký popis pro listing (line-clamp v kartě)
- **Jazyk** — `cs` / `en`
- **Licence** — text field, default „CC BY 4.0"
- **Tagy** — autocomplete (`TagInput`) přes globální taggit DB
- **Viditelnost** — `public` / `members` (jen pro přihlášené)
- **Featured** — toggle (asi jen admin?)
- **Cover obrázek** — upload přes `uploads.articleCover` (server resize na 1600px width, JPEG re-encode)
- **Obsah** — `MarkdownEditor` (left pane edit, right pane live preview)

Po vyplnění:

- **Uložit jako draft** → status `draft`, jen ty vidíš
- **Publikovat** → server zařadí na listing, volitelně **mintne DOI** přes Zenodo

### Use-case 1: Napsat blog post

1. **Články → + Nový článek**
2. Title: „Jak jsem viděl perseidy"
3. Jazyk: cs
4. Body: napiš v markdown editoru — bold, italic, code, listy, MathJax, images
5. **Upload cover image** — vlož jpeg/png (na server resize na 1600px max)
6. Tagy: `perseidy, meteory, pozorovani`
7. Viditelnost: public
8. **Publikovat**
9. Volitelně zaškrtni **Mint DOI** → server pošle na Zenodo (sandbox v dev, prod v produkci)
10. Po publikaci dostaneš URL `/articles?a=jak-jsem-videl-perseidy`

### Use-case 2: Importovat existující Quarto bundle (browser flow)

1. **Články → 📦 Importovat Quarto bundle** (modal)
2. Drag-drop `.zip` (Quarto výstup s `index.html` v rootu)
3. Title, slug (volitelný), summary
4. **Upload** → server uloží pod `/media/quarto/<user_id>/<slug>/`
5. Článek dostane URL, v detailu se zobrazí jako iframe

Alternativně z VS Code / RStudia — viz [Publikování — přehled](publish-overview).

### Use-case 3: Editovat publikovaný článek

1. Otevři detail
2. **✎ Upravit** vpravo nahoře
3. Změň cokoliv kromě slugu (slug je permanentní)
4. **Uložit**
5. Po update se cache invalidate-uje, ostatní hned vidí novou verzi

## Komentáře

Komponenta `ThreadedDiscussion` pod článkem. Featury:

- **Vláknitá** struktura — odpovídáš na konkrétní komentář, vytváří strom
- **Markdown** v komentářích (basic — bold, italic, code, listy, linky)
- **Edit / smazat** vlastní komentáře (admin smaže jakékoli)
- **Auto-refresh** přes React Query polling
- **Empty state** — `articles.commentsEmpty` text pokud žádné komentáře

Komentáře jsou viditelné **jen u publikovaných článků** (`status === "published"`). U draftů místo komentářů vidíš hint „Komentáře budou dostupné po publikování".

## Sdílení na Mastodon

V detail toolbar → **🐘 Sdílet na Mastodon** → otevře `MastodonShareModal` (viz [Mastodon cross-posting](mastodon-crossposting)).

Sdílí se URL **`/clanky/<slug>`** (server-rendered SEO route) — nikoliv `/articles?a=<slug>`. Důvod: SEO route emituje OG meta tagy + JSON-LD, takže Mastodon (i jiné social servery) při fetchu URL vykreslí preview kartu s cover image + title + summary. Reální uživatelé po kliknutí dostanou `<meta refresh>` redirect na SPA URL.

## DOI / Zenodo

Při publikaci s `Mint DOI` checked:

1. Backend pošle metadata article-u na **Zenodo API** (`/api/deposit/depositions`)
2. Zenodo vrátí DOI v formátu `10.5281/zenodo.<id>`
3. Backend uloží do `article.doi`
4. V kartě a detailu se zobrazí jako `DOI 10.5281/zenodo.503402`

Per-user Zenodo token v Settings → Integrace → Zenodo API token. Bez tokenu Astrozor mintuje proti **platform-wide Zenodo sandbox** (env `ZENODO_SANDBOX_TOKEN`).

V dev mode (`DJANGO_DEBUG=true`) defaultně mintuje proti **sandbox.zenodo.org** (testovací DOI, ne reálné).

## RSS / Atom feed

Veřejné články se exportují jako:

- `<HOST>/articles.atom` — Atom 1.0 feed
- `<HOST>/articles.rss` — RSS 2.0 feed

Hodí se pro RSS čtečky (Feedly, Miniflux, Newsboat).

## SEO route `/clanky/<slug>`

Server-rendered HTML stránka s OG meta + JSON-LD `ScholarlyArticle`. Když sdílíš URL na social síti, crawler ji fetchne, parsuje meta, zobrazí krásnou preview kartu. Pak browser dostane `<meta refresh>` redirect na `/articles?a=<slug>` (SPA).

> Pozor: i když je URL pro sdílení `/clanky/<slug>`, **uvnitř Astrozoru** se naviguje na `/articles?a=<slug>` (přes Mastodon share modal a server SEO redirect).

## Engine ikony

V kartě + detailu se ukáže engine type přes brand SVG ikonu:

| Engine | Ikona (z `/icons/`) | Pozadí |
|---|---|---|
| `markdown` | markdown.svg | slate-800 |
| `quarto` | quarto.svg | indigo-950 |
| `rmarkdown` | r.svg | sky-950 |
| `jupyter` | jupyter.svg | amber-950 |

## Co je rezervované / TODO

- **Hashtag search** — TagFilter funguje, ale fulltext search přes title + body zatím chybí (jen tag filter)
- **Translation linking** — propojení CS ↔ EN verze stejného článku, zatím neexistuje
- **Versioning** — DOI je per-publikace, edit článek DOI nemění (Zenodo má samostatný `new version` flow, ale nejsme tam)
- **Citation export** (BibTeX) — zatím manual copy DOI
