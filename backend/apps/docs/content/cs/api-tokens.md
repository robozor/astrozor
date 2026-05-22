---
title: "Správa API tokenů"
section: "2. Publikování"
order: 60
icon: "🔑"
---

# API tokeny

Pro publikování zvenčí (z VS Code, RStudia, Jupyter, curl, vlastního skriptu) potřebuješ **personal access token** — sám si ho vytvoříš v Astrozoru a vložíš do nástroje.

## Vytvoření tokenu

1. Přihlas se v Astrozoru
2. **Nastavení → API tokeny**
3. Tlačítko **Vytvořit token**
4. Popisek (např. „RStudio – pracovní laptop") — viditelný jen tobě
5. Scope: zaškrtni **`publish:articles`** (pro publikování). Případně `read:profile` (zatím nepoužíváno, ale rezervováno).
6. **Vytvořit**
7. **ZKOPÍRUJ plaintext token** — zobrazí se **JEN JEDNOU**. Až dialog zavřeš, server uchovává jen hash, takže ho nemůžeš znovu vypsat.

Formát tokenu: `ast_pat_<base64url-40>`.

## Bezpečnost

- Token = trvalé heslo pro publikování pod tvým účtem. **Nesdílej ho.**
- Pokud ho omylem vystavíš (commit do gitu, screenshot, Slack), **okamžitě ho revokuj** (viz dále) a vytvoř nový.
- Token vyprší? Aktuálně NE — můžeš nastavit `expires_at` při vytváření (zatím přes Django admin).
- Token NEUMOŽŇUJE přihlášení do webového UI ani změnu profilu / hesla. Jen `publish:articles`.

## Revokace

1. **Nastavení → API tokeny**
2. Vedle tokenu klikni **Revoke**
3. Server hned přestane token přijímat. Žádný refresh, žádné okno na změnu — okamžitě.

## Co s tokenem

| Nástroj | Kam ho vložit |
|---|---|
| VS Code | `Astrozor: Set API token` (Secret Storage, šifrované) |
| RStudio addin | `astrozorpub::astrozor_set_token("ast_pat_…")` — uloží do `~/.Renviron` |
| Jupyter / curl | Env var `ASTROZOR_TOKEN` nebo přímo do `Authorization: Bearer …` hlavičky |

## Ověření tokenu

`GET /api/v1/publish/whoami` (hlavička `Authorization: Bearer …`) vrátí:

```json
{
  "user_email": "tvuj@email.cz",
  "token_name": "RStudio – pracovní laptop",
  "scopes": ["publish:articles"]
}
```

Status `401 Unauthorized` = token neexistuje, je revoked, nebo expiroval.

## Best practices

- **Per-device tokeny.** Stejný token na 3 zařízeních = pokud jedno ztratíš/prodáš, musíš revoke a re-setup všech tří. Lepší: jeden token na zařízení.
- **Popisek jako self-documentation.** „VS Code – home desktop", „RStudio – office", … — uvidíš v listing-u, co kde běhá.
- **Periodic rotation.** Co půl roku revoke + nový token. Není to vynucené, ale dobrá hygiena.
- **Nestrkat do veřejných repozitářů.** Token v Git commit historii = leak; gitleaks/truffleHog ho najdou. Použij `.env` nebo Secret Storage.

## Diagnostika

| Chyba | Příčina |
|---|---|
| `401 Unauthorized` | Token neexistuje / revoked / expiroval / špatně zkopírovaný (často chybí poslední znak) |
| `403 Token missing 'publish:articles' scope` | Token byl vytvořený bez správného scope — vytvoř nový |
