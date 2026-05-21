"""Seed the magazine — two tutorial articles (CS+EN) + sample demo
articles with NASA / Wikimedia cover images and Czech lorem ipsum.

The tutorials power the "Jak publikovat" budník on the articles index
(stable slugs `jak-publikovat-quarto-rstudio-vscode` /
`how-to-publish-quarto-rstudio-vscode`). The frontend picks one of
the two by UI language.

Idempotent — articles are keyed by slug and skipped when already present.

Usage:
    python manage.py seed_demo_articles
    python manage.py seed_demo_articles --replace
    python manage.py seed_demo_articles --author robozor@gmail.com
"""

from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.publishing.models import Article
from apps.publishing.rendering import render_markdown

User = get_user_model()


# Tutorial articles powering the "budník" CTA on the articles index.
# Same content in two languages — the frontend serves whichever matches
# the UI language. Image placeholders use placehold.co so the article
# is visually complete even before real screenshots are taken.
TUTORIAL_CS = """\
# Jak publikovat Quarto články přímo z VS Code a RStudio

V Astrozoru můžete publikovat plnohodnotné Quarto i R Markdown dokumenty
**bez kopírování textu** — prostě z editoru, ve kterém už pracujete.
Tento návod ukazuje oba způsoby, krok za krokem.

> **Proč to dělat takhle?** Quarto/R Markdown dokáže do článku zapéct
> interaktivní grafy (plotly), mapy (leaflet), tabulky (DT) i živé výstupy
> z Pythonu nebo R. Astrozor takový balíček zobrazí v sandboxovaném
> iframe — vaše analýza zůstává plně interaktivní pro čtenáře.

---

## 1. RStudio addin `astrozorpub`

V RStudiu nainstalujte balíček (jednorázově):

```r
install.packages("astrozorpub", repos = c(
  astrozor = "https://astrozor.cz/R",
  CRAN = "https://cran.rstudio.com"
))
```

Poté nastavte přístupový token (Settings → API tokens v aplikaci):

```r
astrozorpub::astrozor_set_token("<váš token>")
astrozorpub::astrozor_whoami()  # ověření
```

Otevřete `.qmd` nebo `.Rmd` dokument a v menu **Addins → Publish to Astrozor**
spustíte dialog publikace.

![RStudio addin — dialog publikace](https://placehold.co/1200x600/0f172a/93c5fd?text=RStudio+addin+%E2%80%94+Publish+to+Astrozor)

Vyberete název, slug a souhlas s licencí — addin za vás zavolá `quarto render`
(nebo `rmarkdown::render`), zabalí výstup do ZIP a nahraje. Hotovo.

## 2. VS Code

Pro VS Code zatím nemáme dedikované rozšíření — používá se **stejné multipart
API** jako addin pro RStudio. Stačí vám `curl` nebo Quarto CLI.

```bash
quarto render muj-clanek.qmd
cd muj-clanek_files
zip -r ../bundle.zip .
curl -X POST https://astrozor.cz/api/v1/publish/quarto \\
     -H "Authorization: Bearer <váš token>" \\
     -F "bundle=@../bundle.zip" \\
     -F "title=Můj článek" \\
     -F "slug=muj-clanek" \\
     -F "summary=Krátký popis…"
```

![VS Code — terminál s curl příkazem](https://placehold.co/1200x600/0f172a/93c5fd?text=VS+Code+%E2%80%94+publish+via+curl)

V budoucnu chystáme dedikované VS Code rozšíření — sledujte changelog.

## 3. Co se stane po publikování

* Astrozor uloží váš HTML balík a všechna média (obrázky, JS, CSS) zachová
  vedle `index.html`.
* Plotly grafy, leaflet mapy i DT tabulky **zůstávají interaktivní**.
* Článek se objeví v seznamu článků jako Quarto / R Markdown — s ikonou
  podle enginu.
* Můžete přidat tagy a krátký souhrn (max. 450 znaků) pro sociální sítě.

## 4. Časté problémy

**Shiny runtime není podporován** — Astrozor renderuje staticky.
Pokud máte v Quartu `server: shiny`, publikace se zastaví s chybou.

**Velké balíky (> 100 MB)** — komprimujte obrázky nebo použijte
externí storage (např. Zenodo) pro datasety.

**Zapomenutý token** — `astrozorpub::astrozor_whoami()` vám vrátí 401.
Vygenerujte si nový v Nastavení → API tokens.

---

Pokud na něco narazíte, založte diskusi pod tímto článkem — odpovíme.
"""


TUTORIAL_EN = """\
# How to publish Quarto articles straight from VS Code or RStudio

Astrozor publishes full Quarto and R Markdown documents **without copying
the text out** — you stay in the editor you already use. This guide walks
through both paths.

> **Why bother?** Quarto / R Markdown can bake interactive plotly charts,
> leaflet maps, DT tables and live Python / R output into a single
> document. Astrozor serves the bundle inside a sandboxed iframe — your
> analysis stays fully interactive for readers.

---

## 1. RStudio addin `astrozorpub`

Install the package once:

```r
install.packages("astrozorpub", repos = c(
  astrozor = "https://astrozor.cz/R",
  CRAN = "https://cran.rstudio.com"
))
```

Set your access token (Settings → API tokens):

```r
astrozorpub::astrozor_set_token("<your-token>")
astrozorpub::astrozor_whoami()
```

Open a `.qmd` or `.Rmd` document and run **Addins → Publish to Astrozor**
from the RStudio menu.

![RStudio addin — publish dialog](https://placehold.co/1200x600/0f172a/93c5fd?text=RStudio+addin+%E2%80%94+Publish+to+Astrozor)

The addin renders the document (`quarto render` / `rmarkdown::render`),
zips the output, and uploads. Done.

## 2. VS Code

There is no dedicated extension yet — use the **same multipart API** the
RStudio addin uses, with `curl` or the Quarto CLI.

```bash
quarto render my-article.qmd
cd my-article_files
zip -r ../bundle.zip .
curl -X POST https://astrozor.cz/api/v1/publish/quarto \\
     -H "Authorization: Bearer <your-token>" \\
     -F "bundle=@../bundle.zip" \\
     -F "title=My article" \\
     -F "slug=my-article" \\
     -F "summary=Short summary…"
```

![VS Code — terminal with curl command](https://placehold.co/1200x600/0f172a/93c5fd?text=VS+Code+%E2%80%94+publish+via+curl)

A dedicated VS Code extension is on the roadmap.

## 3. What happens next

* Astrozor stores the HTML bundle and keeps every asset (images, JS, CSS)
  alongside `index.html`.
* Plotly charts, leaflet maps, and DT tables **stay interactive**.
* The article appears in the index with its engine icon (Quarto, R
  Markdown, Jupyter).
* Add tags and a short summary (max 450 characters) for social sharing.

## 4. Common pitfalls

**Shiny runtime is not supported** — Astrozor renders statically. If your
Quarto has `server: shiny`, publishing will fail.

**Large bundles (> 100 MB)** — compress images or move datasets to
external storage (e.g. Zenodo).

**Stale token** — `astrozorpub::astrozor_whoami()` returning 401 means
your token expired. Generate a new one in Settings → API tokens.

---

If something breaks, start a discussion under this article — we'll help.
"""


# --- Demo magazine articles (Czech) ---

# (slug, title, summary, cover_image_url, tags, body_md)
#
# Cover images: placehold.co with deep-space color palettes for the demo
# data — guaranteed to load and visually distinct per topic. Real authors
# will replace these with their own astrophotography on publish.
DEMO_ARTICLES: list[tuple[str, str, str, str, list[str], str]] = [
    (
        "m31-v-zari-pruvodce-pozorovanim",
        "M31 v září: detailní průvodce pozorováním Velké galaxie v Andromedě",
        (
            "Galaxie M31 dosahuje v září ideálního postavení nad horizontem. "
            "V průvodci najdete plán pozorování krok za krokem — od výběru "
            "místa přes nastavení dalekohledu až po identifikaci satelitních "
            "galaxií M32 a M110."
        ),
        "https://images-assets.nasa.gov/image/PIA04921/PIA04921~large.jpg",
        ["m31", "andromeda", "hlubokyVesmir", "pozorovani"],
        """## Lorem ipsum

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod
tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim
veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea
commodo consequat.

![M31 Andromeda](https://upload.wikimedia.org/wikipedia/commons/thumb/c/c2/M31_The_Andromeda_Galaxy_%28and_Friends%29_-_Adam_Evans.jpg/1280px-M31_The_Andromeda_Galaxy_%28and_Friends%29_-_Adam_Evans.jpg)

Duis aute irure dolor in reprehenderit in voluptate velit esse cillum
dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non
proident, sunt in culpa qui officia deserunt mollit anim id est laborum.

### Pozorovací plán

1. Najděte tmavé místo mimo města (Bortle ≤ 5).
2. Nechte oko adaptovat na tmu alespoň 20 minut.
3. Začněte hledáním Cassiopeie a Pegasova čtverce.
""",
    ),
    (
        "saturnuv-prsten-v-amaterskem-dalekohledu",
        "Saturnův prsten v amatérském dalekohledu — co všechno uvidíte",
        (
            "Saturn patří k nejvděčnějším cílům amatérské astronomie. "
            "Co všechno se dá rozeznat při 100×, 200× a 300× zvětšení? "
            "Jaké filtry pomáhají? Praktický rozbor s ukázkami."
        ),
        "https://images-assets.nasa.gov/image/PIA17199/PIA17199~orig.jpg",
        ["saturn", "planety", "dalekohled"],
        """## Lorem ipsum dolor

Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium
doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo
inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.

![Saturn](https://upload.wikimedia.org/wikipedia/commons/thumb/c/c7/Saturn_during_Equinox.jpg/1280px-Saturn_during_Equinox.jpg)

Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut
fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem
sequi nesciunt.

### Co uvidíte při různých zvětšeních

- **100×**: prstenec jako oddělený kruh, Cassiniho dělení sotva.
- **200×**: jasně vidět Cassiniho dělení, struktura prstenců.
- **300×**: detaily v atmosféře, případně Enkeho mezera.
""",
    ),
    (
        "polarni-zare-z-cech-fotografie",
        "Polární záře z Čech: jak ji zachytit a kdy znovu přijde",
        (
            "Geomagnetická bouře z 10. května 2024 přinesla nad Českou "
            "republiku silnou polární záři viditelnou pouhým okem. "
            "Analýza dat z Kp indexu, návod na fotografování a predikce "
            "dalších příležitostí v rámci slunečního cyklu 25."
        ),
        "https://images-assets.nasa.gov/image/GSFC_20171208_Archive_e000614/GSFC_20171208_Archive_e000614~small.jpg",
        ["aurora", "slunce", "fotografie", "spaceWeather"],
        """## Polární záře — kdy a jak

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Maximus solar
storms during cycle 25 have produced auroras visible as far south as
Prague.

![Aurora](https://upload.wikimedia.org/wikipedia/commons/thumb/0/0c/Aurora_Borealis_-_Polar_Lights_in_Tromso%2C_Norway.jpg/1280px-Aurora_Borealis_-_Polar_Lights_in_Tromso%2C_Norway.jpg)

### Doporučená výbava

- Stativ a fotoaparát s manuálním režimem
- Objektiv 14–24 mm, f/2.8 nebo světlejší
- Cílení na sever, ISO 1600–3200, expozice 4–10 s
""",
    ),
    (
        "milky-way-fotografie-novou-zelandou",
        "Mléčná dráha jasněji než kdy předtím — výprava na Novou Zéland",
        (
            "Reportáž z dvoutýdenní výpravy na Jižní ostrov Nového Zélandu. "
            "Bortle 1, výhled na Magellanovy mračna, technika a postprodukce. "
            "Praktické tipy pro plánování podobné cesty."
        ),
        "https://images-assets.nasa.gov/image/PIA18913/PIA18913~large.jpg",
        ["mlecnaDraha", "fotografie", "cestovani"],
        """## Reportáž

Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi
ut aliquip ex ea commodo consequat.

![Milky Way](https://upload.wikimedia.org/wikipedia/commons/thumb/3/3d/Milky_Way_Galaxy_and_a_meteor.jpg/1280px-Milky_Way_Galaxy_and_a_meteor.jpg)

Duis aute irure dolor in reprehenderit in voluptate velit esse cillum
dolore eu fugiat nulla pariatur.
""",
    ),
    (
        "sloupy-stvoreni-james-webb-vs-hubble",
        "Sloupy stvoření — Hubble vs. James Webb v infračervené",
        (
            "Snímky NGC 6611 z Hubbleova teleskopu (1995, 2014) a z JWST "
            "(2022) bok po boku. Co nového odhalila infračervená kamera "
            "NIRCam? Detailní srovnání s vědeckou interpretací."
        ),
        "https://images-assets.nasa.gov/image/PIA15260/PIA15260~orig.jpg",
        ["jwst", "hubble", "hlubokyVesmir", "ngc6611"],
        """## Hubble vs. James Webb

At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis
praesentium voluptatum deleniti atque corrupti.

![Pillars of Creation](https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Pillars_2014_HST_WFC3-UVIS_full-res_denoised.jpg/1280px-Pillars_2014_HST_WFC3-UVIS_full-res_denoised.jpg)
""",
    ),
    (
        "orion-zimni-souhvezdi-dso",
        "Hluboký Orion — průvodce zimními DSO pro malé dalekohledy",
        (
            "Orion v zimě nabízí desítky cílů pro 80–150mm dalekohledy. "
            "Tipy na M42, M43, plamenovou mlhovinu, koňskou hlavu a další. "
            "Mapky, časy a fotografická příprava."
        ),
        "https://images-assets.nasa.gov/image/PIA25434/PIA25434~large.jpg",
        ["orion", "m42", "dso", "zima"],
        """## Zimní Orion

Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia
deserunt mollit anim id est laborum.

![Orion Nebula](https://upload.wikimedia.org/wikipedia/commons/thumb/0/01/Orion_Nebula_-_Hubble_2006_mosaic_18000.jpg/1280px-Orion_Nebula_-_Hubble_2006_mosaic_18000.jpg)
""",
    ),
]


def _word_count(text: str) -> int:
    return len(text.split())


def _reading_minutes(text: str) -> int:
    return max(1, round(_word_count(text) / 200))


class Command(BaseCommand):
    help = "Seed magazine — tutorial articles (CS+EN) + demo articles."

    def add_arguments(self, parser):
        parser.add_argument(
            "--replace",
            action="store_true",
            help="Delete seeded articles by slug first, then recreate.",
        )
        parser.add_argument(
            "--author",
            default=None,
            help="E-mail of the author user. Defaults to the first superuser.",
        )

    def handle(self, *args, **opts):
        author = self._pick_author(opts.get("author"))
        self.stdout.write(f"Author: {author.email}")

        all_specs: list[tuple[str, str, str, str, str, list[str], str]] = []
        # (slug, title, language, summary, cover, tags, body)
        all_specs.append(
            (
                "jak-publikovat-quarto-rstudio-vscode",
                "Jak publikovat Quarto články přímo z VS Code a RStudio",
                "cs",
                "Návod krok za krokem: RStudio addin astrozorpub, "
                "publikace z VS Code přes curl, nejčastější chyby. "
                "Plné Quarto i R Markdown dokumenty s interaktivními grafy.",
                "https://placehold.co/1200x600/1e3a8a/cbd5e1?text=Jak+publikovat+do+Astrozor",
                ["navod", "quarto", "rstudio", "vscode"],
                TUTORIAL_CS,
            )
        )
        all_specs.append(
            (
                "how-to-publish-quarto-rstudio-vscode",
                "How to publish Quarto articles from VS Code or RStudio",
                "en",
                "Step-by-step guide: astrozorpub RStudio addin, publishing "
                "from VS Code via curl, common pitfalls. Full Quarto and "
                "R Markdown documents with interactive plots.",
                "https://placehold.co/1200x600/1e3a8a/cbd5e1?text=How+to+publish+to+Astrozor",
                ["howto", "quarto", "rstudio", "vscode"],
                TUTORIAL_EN,
            )
        )
        for slug, title, summary, cover, tags, body in DEMO_ARTICLES:
            all_specs.append((slug, title, "cs", summary, cover, tags, body))

        if opts.get("replace"):
            slugs = [s[0] for s in all_specs]
            n = Article.objects.filter(slug__in=slugs).delete()
            self.stdout.write(self.style.WARNING(f"Deleted prior seeded rows: {n}"))

        created = 0
        skipped = 0
        for slug, title, lang, summary, cover, tags, body in all_specs:
            if Article.objects.filter(slug=slug).exists():
                skipped += 1
                self.stdout.write(self.style.NOTICE(f"skip: {slug} (already exists)"))
                continue
            html = render_markdown(body)
            a = Article.objects.create(
                slug=slug,
                title=title,
                summary=summary,
                content_md=body,
                content_html=html,
                engine=Article.Engine.MARKDOWN,
                language=lang,
                status=Article.Status.PUBLISHED,
                author=author,
                cover_image_url=cover,
                visibility=Article.Visibility.PUBLIC,
                reading_minutes=_reading_minutes(body),
                published_at=timezone.now(),
            )
            if tags:
                # django-taggit 6.x changed set() to take a list, not *args.
                a.tags.set(tags, clear=True)
            created += 1
            self.stdout.write(self.style.SUCCESS(f"ok:   {slug}"))

        self.stdout.write(
            self.style.SUCCESS(
                f"Done. Created {created}, skipped {skipped} (already present)."
            )
        )

    def _pick_author(self, email: str | None):
        if email:
            try:
                return User.objects.get(email__iexact=email)
            except User.DoesNotExist as e:
                raise SystemExit(f"User {email} not found.") from e
        sup = User.objects.filter(is_superuser=True).order_by("id").first()
        if sup:
            return sup
        any_user = User.objects.order_by("id").first()
        if any_user:
            return any_user
        raise SystemExit(
            "No users in the database. Create a user first "
            "(python manage.py createsuperuser)."
        )
