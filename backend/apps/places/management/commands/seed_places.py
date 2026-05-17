"""Seed 15 well-known CR observatories.

Synthetic seed data assembled from public knowledge. To be replaced with
real ČAS catalog data when available (BLOCKERS.md B-2).

Idempotent: re-running upserts by slug.

Usage:
    python manage.py seed_places
    python manage.py seed_places --replace  # delete existing seeded rows first
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.utils.text import slugify

from apps.places.models import Place

# Tuples: (name, kind, lat, lon, elevation_m, website, bortle_class, description, address)
SEED: list[tuple[str, str, float, float, int | None, str, float | None, str, str]] = [
    (
        "Štefánikova hvězdárna",
        Place.Kind.OBSERVATORY_PUBLIC,
        50.0810, 14.3990, 324,
        "https://www.planetum.cz/stefanikova-hvezdarna/",
        7.0,
        "Veřejná hvězdárna na Petříně v Praze. Provozuje Planetum.",
        "Strahovská 205, 118 46 Praha 1",
    ),
    (
        "Hvězdárna a planetárium Brno",
        Place.Kind.OBSERVATORY_PUBLIC,
        49.2069, 16.5832, 305,
        "https://www.hvezdarna.cz/",
        6.0,
        "Veřejná hvězdárna a planetárium na Kraví hoře v Brně.",
        "Kraví hora 522/2, 616 00 Brno",
    ),
    (
        "Hvězdárna a planetárium Plzeň",
        Place.Kind.OBSERVATORY_PUBLIC,
        49.7745, 13.4180, 376,
        "https://www.hvezdarnaplzen.cz/",
        6.5,
        "Veřejná hvězdárna na Lochotíně v Plzni.",
        "U Dráhy 11, 318 00 Plzeň",
    ),
    (
        "Astronomický ústav AV ČR — Ondřejov",
        Place.Kind.OBSERVATORY_PRIVATE,
        49.9106, 14.7833, 528,
        "https://www.asu.cas.cz/",
        4.0,
        "Hlavní astronomický ústav ČR s 2m Perek telescope.",
        "Fričova 298, 251 65 Ondřejov",
    ),
    (
        "Hvězdárna Valašské Meziříčí",
        Place.Kind.OBSERVATORY_PUBLIC,
        49.4628, 17.9764, 365,
        "https://www.astrovm.cz/",
        4.5,
        "Specializovaná na sluneční pozorování a meteorologii.",
        "Vsetínská 78, 757 01 Valašské Meziříčí",
    ),
    (
        "Hvězdárna a planetárium Hradec Králové",
        Place.Kind.OBSERVATORY_PUBLIC,
        50.1750, 15.8330, 245,
        "https://www.astrohk.cz/",
        5.5,
        "Veřejná hvězdárna se silnou popularizační činností.",
        "Národních mučedníků 256, 500 02 Hradec Králové",
    ),
    (
        "Hvězdárna Karlovy Vary",
        Place.Kind.OBSERVATORY_PUBLIC,
        50.2348, 12.8980, 595,
        "https://www.hvezdarnakv.cz/",
        4.5,
        "Lázeňská hvězdárna na Hůrkách.",
        "Karlovy Vary",
    ),
    (
        "Hvězdárna Vsetín",
        Place.Kind.OBSERVATORY_PUBLIC,
        49.3411, 17.9954, 393,
        "https://www.hvezdarna-vsetin.cz/",
        4.0,
        "Komunitní hvězdárna na okraji Vsetína.",
        "Vsetín — Jasenice",
    ),
    (
        "Hvězdárna v Úpici",
        Place.Kind.OBSERVATORY_PUBLIC,
        50.5089, 16.0140, 410,
        "https://www.obsupice.cz/",
        4.5,
        "Sluneční pozorování v Podkrkonoší.",
        "U Lipek 160, 542 32 Úpice",
    ),
    (
        "Hvězdárna Jindřichův Hradec",
        Place.Kind.OBSERVATORY_PUBLIC,
        49.1450, 15.0030, 480,
        "https://www.hvezdarnajh.cz/",
        4.0,
        "Veřejná hvězdárna a planetárium v jižních Čechách.",
        "Vajgar, Jindřichův Hradec",
    ),
    (
        "Sedlčanská hvězdárna Josefa Sadila",
        Place.Kind.OBSERVATORY_PUBLIC,
        49.6594, 14.4226, 367,
        "https://www.hvezdarna-sedlcany.cz/",
        4.0,
        "Soukromá hvězdárna s veřejným provozem.",
        "Sedlčany",
    ),
    (
        "Stanoviště Říp",
        Place.Kind.SPOT_PERMANENT,
        50.4019, 14.3071, 459,
        "",
        4.5,
        "Vrchol Řípu — známé pozorovací místo s výhledem do okolí.",
        "Krabčice — Říp",
    ),
    (
        "Stanoviště Pasecká skála",
        Place.Kind.SPOT_PERMANENT,
        49.2230, 16.0890, 600,
        "",
        4.0,
        "Vyhlídkové místo na okraji CHKO, oblíbené místo amatérů.",
        "Vysočina",
    ),
    (
        "Stanoviště Černý důl",
        Place.Kind.SPOT_PERMANENT,
        50.6500, 15.7700, 690,
        "",
        3.5,
        "Tmavá lokalita v Krkonoších.",
        "Krkonoše",
    ),
    (
        "Stanoviště Jeseníky — Praděd",
        Place.Kind.SPOT_PERMANENT,
        50.0830, 17.2310, 1491,
        "",
        3.0,
        "Nejvyšší hora Jeseníků, výborné podmínky.",
        "Jeseníky",
    ),
]


class Command(BaseCommand):
    help = "Seed (or upsert) 15 well-known Czech observatories and observation spots."

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            "--replace",
            action="store_true",
            help="Delete all places with the seed slugs before reinserting.",
        )

    def handle(self, *args, **options) -> None:
        replace = options["replace"]

        slugs = [slugify(name) for (name, *_) in SEED]
        if replace:
            deleted, _ = Place.objects.filter(slug__in=slugs).delete()
            self.stdout.write(self.style.WARNING(f"Deleted {deleted} existing seeded rows."))

        created = updated = 0
        for name, kind, lat, lon, elev, website, bortle, description, address in SEED:
            slug = slugify(name)
            obj, was_created = Place.objects.update_or_create(
                slug=slug,
                defaults={
                    "name": name,
                    "kind": kind,
                    "status": Place.Status.PUBLISHED,
                    "lat": lat,
                    "lon": lon,
                    "elevation_m": elev,
                    "website": website,
                    "bortle_class": bortle,
                    "description": description,
                    "address": address,
                },
            )
            if was_created:
                created += 1
            else:
                updated += 1

        self.stdout.write(
            self.style.SUCCESS(f"Seed complete: {created} created, {updated} updated."),
        )
