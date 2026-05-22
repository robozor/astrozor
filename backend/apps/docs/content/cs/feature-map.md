---
title: "Mapa hvězdáren"
section: "3. Funkce"
order: 10
icon: "🗺"
---

# Mapa hvězdáren

Hlavní obrazovka po přihlášení. Interaktivní mapa České republiky (a okolí) s vrstvami a stovkami označených míst.

## Vrstvy a styly

Vpravo na mapě panel **Ovládání mapy** (☰):

- **Mapový styl** — `OSM`, `Dark`, `Satellite`, `Topo`
- **PMTiles theme** — `Dark` / `Light` (per-tile vektorový styl)
- **Světelné znečištění** — overlay s mapou jasu noční oblohy (NASA VIIRS), opacity se dá nastavit. Tmavé oblasti = dobrá obloha.
- **Filtr stavu** — `Vše` / `Aktivní` (kde je někdo právě check-in nul) / `Sledované`
- **Filtr typu** — viditelné kindy markerů (zaškrtávací)
- **Events toggle** — zobrazí/skryje markery akcí

Volby se ukládají do profilu (`map_preferences`) — po dalším přihlášení vidíš stejné nastavení.

## Markery míst (4 typy)

Tvar markeru komunikuje **typ místa**, barva jen **aktivitu** (jestli tam někdo právě je). Kindy:

| Tvar | Kind | Co to je |
|---|---|---|
| 🌐 Kupole s vertikální štěrbinou | `observatory_public` | **Veřejná hvězdárna** — instituce přístupná veřejnosti, často s prohlídkami a akcemi |
| 🏛 Krabicovitá budova se sedlovou střechou + zámek | `observatory_private` | **Soukromá hvězdárna** — privátní teleskopické stanoviště, detail jen pro přihlášené |
| ⭐ 5-cípá hvězda | `spot_permanent` | **Stálé stanoviště** — místo pod tmavou oblohou bez budovy (Říp, Praděd, Pasecká skála…) |
| ⛺ Úzký vysoký trojúhelník (stan) | `spot_temporary` | **Dočasné stanoviště** — pop-up pozorovací místo (star party na neoficiálním pozemku) |

Markery jsou **SVG silhouety** — ne emoji. Velikost 22 px, scan-friendly i v mid-zoomu.

## Barvy a stavy

- **Šedý/bílý marker** = běžný stav, žádná aktivita
- **Modré tělo + pulsující červené halo** = **aktivní místo** (někdo se tam právě check-in nul). Pulse je červený, aby pop-l přes zelené OSM landuse vrstvy
- **Žlutá hvězdička v pravém dolním rohu markeru** = **sledované místo** (Subscribed badge — odebíráš změny tohoto místa)

## Markery akcí (📍)

Akce mají **samostatný marker** — pin emoji **📍** s drop-shadow. Zapnout/vypnout přes toggle **Events** v mapovém ovládání.

- Hover ukáže title + status (`návrh` / `ohlášeno` / `registrace` / `zapsáno` / `probíhá`)
- Klik otevře panel s detailem akce — popis, datum, registrace, organizátor

Eventy mohou viset i nad places (např. Star party na konkrétní hvězdárně) — to znamená že na jednom místě uvidíš zároveň kuploví marker i pin.

## Cluster markery

Při oddáleném zoomu se body shluknou do **kruhové bubliny s číslem** — `2`, `5`, `12`… Klikem se rozbalí (zoom-in na cluster).

## Detail místa

Klikem na marker se otevře **panel detailu** vpravo:

- Název + popis
- Souřadnice + nadmořská výška
- **Bortle stupeň** + SQM (kvalita oblohy)
- Provozovatel + kontakt
- Aktuální tipy a aktuality (kdo tam dnes je — check-iny)
- **Tlačítko Sledovat** (subscribe) — dostaneš notifikaci, když organizátor naplánuje akci nebo se tam někdo check-in ne
- Spojené **akce** (sekce dole) — calendar pro toto místo

## Check-in

Pokud jsi přímo na místě, můžeš se na něj **check-in nout**:

- Tlačítko **Jsem tady** v detail panelu (vyžaduje aktuální GPS pozici v dosahu místa)
- Status místa se přepne na **aktivní** (modré tělo + pulse)
- Ostatní sledující vidí, že tam někdo je
- Volitelně se přes Mastodon postuje toot „checked in @ X" (zapni v Settings → Mastodon → autopost checkin)

## Mobilní využití

Na mobilu je mapa fullscreen. Spodní tlačítko **Otevřít panel ☰** ukáže Ovládání mapy. Pinch-to-zoom, drag pan, double-tap zoom — standard.

## Co je užitečné

- **Plánování pozorovací noci** — vyber si nejbližší místo s nejnižším Bortle stupněm
- **Cestování za eklipsy / komety** — najít tmavou oblohu na trase
- **Vzdělavatelé** — ukázat studentům kvalitu oblohy v jejich kraji
- **Hvězdárny** — propagovat své pozorovací noci a akce

## Příspívání

**Chybí ti místo?** Vlož přes Settings → Místa (zatím admin-only, brzy public PR flow). Soukromé stanoviště si může každý uživatel přidat sám.
