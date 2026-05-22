---
title: "Akce"
section: "3. Funkce"
order: 30
icon: "📅"
---

# Akce

Sekce **Akce** je kalendář dění v české astronomické komunitě — pozorovací noci, srazy, přednášky, online setkání, geocaching expedice, výpravy na tmavou oblohu.

## Hlavní obrazovka

V horní liště:

- **Tagy** (filtr `Filtrovat dle tagů`) — klikem na chip filtruje seznam
- **Zahrnout citizen-science sprinty** (checkbox) — když je zapnuto, do listingu se přimíchávají sprinty z Citizen Science (fuchsia karty)
- **+ Nová akce** (tlačítko, pro přihlášené)

Pod toolbar-em **kalendářový přehled** (`EventsCalendar`) — měsíční mřížka, na každém dni puntíky s počtem akcí. Sprinty se zobrazují jako fuchsia barvičky natažené přes datumový rozsah.

**Klik na den** v kalendáři filtruje listing pod ním na akce začínající ten den. Druhý klik filtr zruší.

## Seznam akcí

Karta každé akce ukazuje:

- **Název** + status badge (jedna ze 7 hodnot — `draft`, `announced`, `registration_open`, `registration_closed`, `in_progress`, `finished`, `cancelled`)
- **Datum + čas** v tvé timezone (přes `TimeDisplay` — viz [Časové zóny v Profilu](feature-settings))
- **Místo** — buď propojené z mapy (`place_name`), nebo `external_address`, nebo GPS souřadnice (`external_lat, external_lon`)
- **Počet účastníků** `5 / 20` (kapacita) nebo jen `5` (bez kapacity)
- **Feature ikony** — co akce nabízí: 🎥 video meeting, 💬 Discord, 🧭 geocaching, 📻 rádio
- **Popis** (zkrácený na 2 řádky)
- **Tagy**

## Použití — jak najít akci a přihlásit se

### Use-case 1: Najít víkendovou akci v okolí

1. Otevři **Akce** v hlavní navigaci
2. V kalendáři klikni na **sobotu nebo neděli** v aktuálním týdnu → listing se zúží na ten den
3. Filtrace přes **Filtrovat dle tagů** — vyber tag jako `pozorování` nebo `Mléčná dráha`
4. Projdi kartičky, ikony ukáží, jestli je akce online (🎥), na Discordu (💬), nebo se sdílí radiofrekvence (📻)
5. Klikem na kartu otevřeš detail

### Use-case 2: Přihlásit se na akci

1. Otevři detail akce (klik z listingu nebo z kalendáře)
2. Hlavička ukáže status, datum, místo, organizátora
3. Pokud má akce `status: registration_open` a jsi přihlášený, vidíš modré tlačítko **Přihlásit se**
4. Klik → server vytvoří registraci → tlačítko se přepne na **Zrušit přihlášení**
5. Klikni na **📅 Stáhnout iCal** → soubor `.ics` se stáhne, otevři ho ve svém kalendáři (Google Calendar / Apple Calendar / Outlook) → akce se importuje s plnou polohou a popisem

Pokud akce má `status: registration_closed`, tlačítko nevidíš. Detail je read-only.

Pokud nejsi přihlášen, místo Přihlásit se vidíš **Přihlas se pro registraci** → otevře login modal.

### Use-case 3: Připojit se na online část akce

V detailu akce jsou **action chips** — zobrazují se jen pokud organizátor vyplnil daná pole:

- 🎥 **Připojit se ke schůzce** (`meeting_url`) — Jitsi, Zoom, Google Meet, …
- 💬 **Discord** (`discord_url`) — invite link na Discord kanál
- 🧭 **Geocaching** (`geocache_url`) — link na geocache (akceptuje GC kód, automaticky přidá `geocaching.com/geocache/` prefix)
- 📻 **`145.500 MHz`** (`radio_frequency`) — VHF/UHF frekvence pro mobilní pozorování (read-only chip)

## Použití — jak vytvořit a vést akci

### Use-case 4: Vytvořit pozorovací noc na konkrétní hvězdárně

1. **Akce → + Nová akce**
2. **Název** — povinný, např. „Pozorování Saturna — Štefánikova hvězdárna"
3. **Popis** — plain text, zachovává řádkování (`whitespace-pre-wrap`, **ne** markdown)
4. **Začátek + konec** — datetime picker. Konec je volitelný.
5. **Místo** — `LocationPicker` komponenta:
   - **Vyber z mapy** — vyhledá v existujících `Place` objektech (hvězdárny, stanoviště)
   - **Externí adresa** — text + souřadnice (např. „Lounská 5, Praha 5") — pokud chceš na místě, které ještě v mapě není
6. **Kapacita** — číslo nebo 0 (bez limitu)
7. **Viditelnost** (`VisibilityPicker`) — `public` / `members` / `private`
8. **Akční pole** (volitelná, generují chip v detailu):
   - Meeting URL (video schůzka)
   - Discord URL (kanál)
   - Geocaching URL nebo GC kód
   - Radio frequency (text — frekvence, módu)
9. **Tagy** — vyhledávací helper (`TagInput`) — napiš a klikni Enter
10. **Status** — default `draft`
11. **Vytvořit**

Akce dostane URL `/events?e=<slug>` — sdílí se snadno.

### Use-case 5: Otevřít registrace na vytvořené akci

Po vytvoření akce je status `draft` — nikdo ji nevidí kromě tebe. Pro publikaci:

1. Otevři detail akce (po vytvoření jsi tam automaticky)
2. V kartě **Akce organizátora** dole klikni na tlačítko transition **→ announced** (akce je oznámená, ale registrace ještě nejsou otevřené)
3. Pak **→ registration_open** — registrace běží
4. Když chceš stop nábor: **→ registration_closed**
5. V den akce: **→ in_progress** (akce probíhá)
6. Po skončení: **→ finished**

Všechny tranzice jsou **bidirektivní** kromě self-loop — můžeš se vrátit z `registration_closed` zpět na `registration_open`, atd.

### Use-case 6: Zrušit akci

1. Detail akce → **Akce organizátora**
2. **→ cancelled**
3. Status se přepne na červený `cancelled`
4. Akce v listingu zůstává viditelná (s červeným statusem), ale registrace nelze
5. Pro úplné odstranění klikni na **✕ Smazat** v top toolbaru (potvrzovací dialog)

> **Pozor:** Aktuálně neexistuje automatická notifikace zaregistrovaným při zrušení. Komunikuj zrušení sám přes Discord / email.

## Sprinty z Citizen Science

Když je toggle **Zahrnout sprinty** zapnutý (default), v kalendáři i listingu vidíš **fuchsia karty** s tagem `[sprint]`. Klik vede přímo na detail sprintu v sekci [Citizen Science](feature-citizen-science) (nikoliv do detailu akce — sprinty se spravují tam).

To umožňuje **jednotný kalendář** všech komunitních aktivit (akce + sprinty) bez duplikace v navigaci.

## Detail akce — overview

| Pole | Význam |
|---|---|
| **Status** | jedna ze 7 hodnot (viz výše) |
| **Datum od/do** | `TimeDisplay` — zobrazí UTC + místní čas (dle GPS) + tvůj čas (dle profilu), záleží co máš zapnuté v Settings → Časové zóny |
| **Místo** | `place_name` (z mapy) / `external_address` (text) / nebo `lat, lon` |
| **Organizátor** | `UserNameLink` — klik otevře public profil |
| **Popis** | plain text se zachováním newlines |
| **Action chips** | 🎥 / 💬 / 🧭 / 📻 / 📅 — viz výše |
| **Registrace** | count / capacity + Register/Cancel button (jen pro `registration_open`) |
| **Organizer actions** | status transition buttons (jen organizátor + staff) |

## iCal export

Tlačítko **📅 Stáhnout iCal** v detailu akce vrátí `.ics` soubor:

- Importuj do Google Calendar, Apple Calendar, Outlook
- Obsahuje: title, popis, místo, časy
- Jednorázový download — **není** to subskripce-feed (po update akce musíš stáhnout znovu)

## Co ne­existuje (a co bys čekal/a)

Pro úplnost — tyto featury si někdy přečteš v komentářích na fóru, ale **v aktuálním FE NEJSOU**:

- Předpovědi počasí v akci (clear-sky chart) — manuálně přes externí službu
- Carpool board (kdo nabízí svoz) — řeš v Discord kanálu akce
- QR check-in na místě — používej manuální seznam organizátora
- Hromadná notifikace organizátora účastníkům — přes Discord webhook (z Astrozor strany)
- CSV export účastníků — zatím přes Django admin
- Automatický reminder 24h před akcí — není
- ICS feed (subscribe URL) — je jen single-event download

Tyto featury můžou přibýt; aktuální verze je MVP.
