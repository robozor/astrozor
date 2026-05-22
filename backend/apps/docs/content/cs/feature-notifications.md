---
title: "Notifikace"
section: "3. Funkce"
order: 70
icon: "🔔"
---

# Notifikace

Astrozor má **tři nezávislé notifikační kanály**:

1. **In-app zvonek** v hlavičce (vždy zapnutý, default kanál)
2. **Discord webhook** (volitelné, per-typ-události)
3. **Web push** v prohlížeči (volitelné, kompletní set)

## 1) In-app zvonek

Vpravo nahoře v hlavičce je **🔔 zvonek**. Astrozor sem fan-out-uje **2 typy interních událostí**:

| Kind | Trigger |
|---|---|
| `chat.message` | Někdo poslal zprávu v chatu místa, které sleduješ |
| `presence.checkin` | Někdo se check-in nul na místě, které sleduješ |

> Další typy (`publishing.article`, `events.event`, `citizen.campaign`) jsou v backendu **rezervované, ne aktivované** — backend modely je obsahují jako TODO. Pro tyto události aktuálně dostaneš jen Discord notifikaci (pokud máš zapnuté — viz níže) nebo web push.

### Použití zvonečku — standardní logika

- **Badge s číslem** vpravo nahoře na zvonečku ukazuje **počet nepřečtených** (rose-500, max display `99+`)
- **Klik na zvoneček** otevře dropdown s posledními **20 notifikacemi**
- **Nepřečtené** notifikace mají:
  - Indigo-950/30 pozadí
  - Modrou tečku vlevo od textu
- **Přečtené** mají standardní (slate-800 hover) pozadí, bez tečky
- **Klik na konkrétní notifikaci**:
  1. Označí ji jako přečtenou (POST `/notifications/<id>/read`)
  2. Pokud má notifikace `link` (např. `/places/stefanikova-hvezdarna`), naviguje tam
  3. Zavře dropdown
- **„Označit vše jako přečtené"** tlačítko v záhlaví dropdownu (viditelné jen když `unread > 0`) — POST `/notifications/read-all`
- Refresh-uje se každých 15 sekund (polling, žádný WebSocket)

### Use-case: Vyřídit hromadu starých notifikací

1. Klik na 🔔 → otevře dropdown
2. Vidíš 20 položek, část indigo (nepřečtené)
3. Vpravo nahoře v dropdownu klikni **Označit vše jako přečtené**
4. Všechny zezelenají (badge zmizí)
5. Server uloží `read_at = now` na všechny

### Use-case: Skočit na detail z notifikace

1. Klik na 🔔
2. Najdi notifikaci „Někdo se check-in nul na Praděd"
3. Klik na řádek
4. Astrozor naviguje na `/places/praded` (mapový panel s detailem)
5. Notifikace se v DB označí jako přečtená

## 2) Discord notifikace (webhook)

**Self-service** opt-in přes Settings → Notifikace.

### Setup

1. V Astrozor Settings → Notifikace → **Discord webhook URL**:
   - Na svém Discord serveru: **Server Settings → Integrations → Webhooks → New Webhook → Copy URL**
   - URL formát: `https://discord.com/api/webhooks/<id>/<token>`
   - Vlož do Astrozor pole, klikni Uložit
2. **Discord notifikace — typy událostí** sekce dole — zaškrtni kindy, které chceš:

| Kind | Co fan-out-uje |
|---|---|
| `place_followed_checkin` | Check-in na **tobou sledovaném** místě |
| `place_any_checkin` | **Jakýkoliv** check-in kdekoliv (může být hodně) |
| `article_published` | Nový článek (lze filtrovat na konkrétní autory) |
| `event_status_changed` | Změna statusu akce (filtrovatelné na organizátory, slugy, cílové stavy) |
| `project_lifecycle` | Vznik / zrušení projektu (lze omezit jen na vznik nebo jen na zrušení) |
| `campaign_status_changed` | Změna stavu citizen-science kampaně (lze filtrovat) |

Každý kind má pole `filters` (JSON) pro fine-tuning — UI ti nabídne checkboxy / textová pole podle typu.

3. **Uložit**

### Test webhook

Po nastavení webhook URL: na detail Discord webhooku v Astrozor je zatím **bez tlačítka „Test"** — manuálně si pošli zkušební check-in nebo počkej na reálnou událost.

> **TODO**: Test webhook tlačítko zatím chybí. Workaround: udělej si vlastní check-in na sledovaném místě a sleduj Discord.

### Per-kind filtry

Některé Discord kindy mají **filters JSON pole**:

- `article_published` → `{author_emails: ["a@x.cz"]}` (prázdné = všichni)
- `event_status_changed` → `{organizer_emails: [...], event_slugs: [...], to_states: ["registration_open"]}` (každé prázdné = bez omezení)
- `project_lifecycle` → `{actions: ["created", "archived"]}` (prázdné = oba)
- `campaign_status_changed` → analogicky event

UI pro tyto filtry je v `DiscordPrefsSection` komponentě v Settings.

## 3) Web push

**Status:** Aktuálně **není v UI exponované** jako toggle. Backend má `apps.notifications` s VAPID infrastrukturou připravenou, ale tlačítko **Povolit push** ve Settings zatím chybí.

> **TODO**: Web push toggle v UI. Backend je hotový (VAPID keys přes env vars `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`).

## 4) E-mail

ADR-003: Astrozor **neposílá notifikační email** kromě:

1. **Email verifikace** při registraci
2. **Password reset** flow

Žádné marketing emaily, žádné digesty, žádné komentář-reply emaily. Pro real-time notifikace přes Discord nebo zvoneček.

> **Pozn:** Event reminders 24h před akcí, které jsem dříve zmiňoval, **také aktuálně nejsou implementované**. Pokud chceš reminder, přidej akci do svého kalendáře přes iCal export (viz [Akce](feature-events)).

## Subscriptions

Aby ti zvoneček a Discord něco posílaly, musíš mít aktivní **subscription**. Aktuálně Astrozor podporuje jen **subscriptions na místa** (`kind: place`).

- V detailu místa na mapě klikni **Odebírat**
- Vznikne `Subscription(kind=place, target_id=<place_slug>)`
- Od teď budeš dostávat:
  - In-app zvoneček: `chat.message` a `presence.checkin` z tohoto místa
  - Discord webhook (pokud zapnutý): `place_followed_checkin` z tohoto místa

> Plánované, **zatím ne**: subscriptions na projekty (kind: project) a akce (kind: event).

## Datový model

Pro úplnost, jak to vypadá v DB:

```python
class Notification:
    user, kind, source_kind, source_id, title, body, link,
    created_at, read_at  # read_at=None == unread

class Subscription:
    user, kind (jen "place"), target_id, created_at

class DiscordPreference:
    user, kind (6 typů), enabled, filters (JSON), updated_at
```
