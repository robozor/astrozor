---
title: "Ukázkový článek z Astrozor in-app editoru"
lang: cs
summary: "Demonstruje markdown features, které Astrozor podporuje."
tags: [ukázka, markdown, astrozor]
---

# Ukázkový článek z Astrozoru

Tento článek byl napsán **přímo v Astrozor in-app markdown editoru**. Stáhni si ho, vlož obsah do editoru přes **Články → + Nový článek** a publikuj — ověříš si, že in-app flow funguje.

## Markdown features

### Texty a formátování

- **Bold**, _italic_, ~~strikethrough~~, `inline code`
- Vnořené **bold s _italic_ uvnitř** kombinace
- [Odkaz na Astrozor](https://astrozor.cz) — automaticky linkable

### Seznamy

1. Číslovaný seznam
2. S druhou položkou
3. A třetí

- Odrážkový seznam
  - Vnořená položka
  - A druhá
- Druhá top-level

### Task list

- [x] Napsat ukázku
- [x] Otestovat publikaci
- [ ] Sdílet s komunitou

### Kód

Inline `code` funguje. Bloky kódu se syntax highlighting:

```python
def magnituda(flux_ratio: float) -> float:
    """Vrátí rozdíl magnitud z poměru toků (Pogson)."""
    import math
    return -2.5 * math.log10(flux_ratio)

print(magnituda(100))  # -5.0
```

```r
# R varianta
pogson <- function(flux_ratio) -2.5 * log10(flux_ratio)
pogson(100)
```

### Tabulky

| Objekt        | Magnituda | Vzdálenost (pc) |
|---------------|-----------|-----------------|
| Sirius A      | -1.46     | 2.64            |
| Vega          | 0.03      | 7.68            |
| Polárka       | 1.98      | 132             |
| Betelgeuse    | 0.42      | ~168            |

### Citace

> „Někde, někdo nesmírně chytrý je odhodlán nás najít."
> — Carl Sagan, Bledě modrá tečka

### Matematika (MathJax)

Pogsonův vzorec inline: $m_1 - m_2 = -2.5 \log_{10}(F_1 / F_2)$

Nebo jako display equation:

$$
\Phi(\lambda) = \int_0^\infty B(\lambda, T) \cdot R(\lambda) \, d\lambda
$$

### Obrázky

![Mléčná dráha nad Pradědem](https://example.com/milky-way-praded.jpg "Mléčná dráha")

(Pro vlastní obrázky použij tlačítko **📷 Upload obrázek** v editoru.)

### Horizontální čára

Před ní text.

---

Po ní text.

## Závěr

Pokud tohle vidíš na Astrozoru správně vyrenderované — markdown editor funguje. Pro pokročilejší formáty (interaktivní grafy, R kód, Python output) viz [Quarto / Jupyter ukázky](/articles).
