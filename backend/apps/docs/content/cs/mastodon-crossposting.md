---
title: "Mastodon cross-posting"
section: "4. Pokročilé"
order: 10
icon: "🐘"
---

# Mastodon cross-posting

Astrozor je první-class občan Fediverse. Můžeš propojit svůj **Mastodon účet** (nebo jiný ActivityPub server) s Astrozor profilem a publikované články, akce nebo úspěšné sprinty se ti budou cross-postovat jako tooty.

## Jak to funguje

Astrozor není sám sebou Fediverse server (zatím — federation server je v roadmapě). Místo toho **registruje OAuth app** na tvém Mastodon serveru a postuje tooty **z tvého jména**.

To znamená:
- **Tvoje sledování má tvůj toot** (Astrozor není mezi-vrstva)
- **Tvoje moderace** — Mastodon server moderuje tvé tooty stejně jako kdybys je psal ručně
- **Bez vendor lock-in** — odpojíš a tvoje předchozí tooty zůstanou na Mastodonu

## Propojení

V **Nastavení → Propojené účty → Mastodon**:

1. **Vlož URL svého Mastodon serveru** — `mastodon.social`, `fosstodon.org`, `astrodon.social`, libovolný kompatibilní (Pleroma, GoToSocial, Akkoma fungují)
2. Astrozor dynamicky **zaregistruje OAuth app** na tom serveru (jedno-time, per instance)
3. Přesměrování na tvůj Mastodon → schválíš oprávnění (`write:statuses`, `read:accounts`)
4. Astrozor uloží per-instance access token
5. Hotovo — vidíš tvůj Mastodon handle v profilu

**Více Mastodon serverů?** Bez problému — můžeš mít více Identity, Astrozor je rozlišuje per-instance.

## Cross-post článku

Po publikování článku se v hlavičce objeví tlačítko **🐘 Sdílet na Mastodon**. Otevře dialog:

```
📰 Test Markdown publikace z VS Code
https://astrozor.cz/clanky/test-markdown-publikace-z-vs-code

#astronomie #astrozor #publikace
```

- **Edituj text** před odesláním
- **Visibility** — Public / Unlisted / Followers only / Direct (per Mastodon)
- **Content warning** (CW) — volitelné varování nad toot (např. „Spoiler: vědecký výsledek")
- **Image attach** — pokud má článek cover image, automaticky se přibalí jako Mastodon media

Klikni **Toot** — Mastodon API request odejde, dostaneš ID toot-u zpět a v Astrozoru se uloží do `Article.mastodon_status_id`.

## Mastodon Rail

V Astrozor profilu vedle hlavního obsahu se zobrazuje **Mastodon Rail** — feed posledních ~10 tvých Mastodon toots. Nepostuje, jen čte přes Mastodon API.

To znamená: profil v Astrozoru ukáže nejen tvé Astrozor články, ale i tvou Mastodon aktivitu. Pro fanoušky vědy a federovanou kulturu.

## Auto-share

V **Nastavení → Mastodon → Auto-share**:

- **Vždy** — každý publikovaný článek se automaticky toot-ne (bez dialogu)
- **Vyzvat** — default, vždy se otevře dialog
- **Nikdy** — tlačítko se nezobrazuje vůbec

## Odpojení

V **Nastavení → Mastodon → Odpojit**:

- Astrozor smaže access token
- OAuth app na Mastodon serveru zůstává (může to revokovat Mastodon-side přes Settings → Authorized apps)
- Stávající tooty zůstávají na Mastodonu (Astrozor je neumí smazat ani zpětně editovat)

## Bezpečnost

- **Per-instance OAuth** = pokud jeden Mastodon server padne / má únik, ostatní instance Astrozor uživatelů nejsou ovlivněny
- **Token je read-write na `statuses`** — Astrozor může číst tvé tooty (pro Rail) a posílat nové. **Nemůže** smazat tvé existující tooty, změnit profil, blokovat / mute, číst DM
- **Astrozor toot je vždy `from your account`** — Mastodon to ukáže jako tvůj post, ne jako od „Astrozor bot"

## Pro koho

- Astronomové na Mastodonu (`@astro@mastodon.social` apod.) — automatické sdílení článků
- Veřejnost — vidíš nejen Astrozor content, ale i autorovo Mastodon postování
- Komunita — sledování `#astrozor` a `#astronomy` napříč Fediverse

## Troubleshooting

| Problém | Řešení |
|---|---|
| `Mastodon server unreachable` | Server je dočasně dolů — zkus později |
| `OAuth app registration failed` | Server nepodporuje `POST /api/v1/apps` (Pleroma s vypnutými registracemi) |
| Toot neodejde, `401 Unauthorized` | Token byl revoked Mastodon-side — odpoj a znovu propoj |
| Rail nezobrazuje toots | Account je `private` nebo `silenced` — Astrozor čte přes public timeline |
