"""Backfill bortle_class on Place rows using the GIBS-based estimator.

Default: only fills rows where bortle_class IS NULL (idempotent — safe to
re-run). With --all, overwrites every existing value (use when re-sourcing
or after improving the estimator's luminance curve).

Rate-limited at 1 req/s by default to stay polite to NASA GIBS.
"""

from __future__ import annotations

import time

from django.core.management.base import BaseCommand

from apps.places.light_pollution import estimate_bortle
from apps.places.models import Place


class Command(BaseCommand):
    help = "Backfill bortle_class on places from NASA Black Marble VIIRS tiles."

    def add_arguments(self, parser):
        parser.add_argument(
            "--all",
            action="store_true",
            help="Re-estimate every place, not just those with NULL bortle_class.",
        )
        parser.add_argument(
            "--sleep",
            type=float,
            default=1.0,
            help="Seconds to sleep between GIBS requests (default 1.0).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Print what would change without writing to DB.",
        )

    def handle(self, *args, all: bool, sleep: float, dry_run: bool, **opts):  # noqa: A002
        qs = Place.objects.all() if all else Place.objects.filter(bortle_class__isnull=True)
        total = qs.count()
        self.stdout.write(f"Estimating Bortle for {total} place(s)…")

        ok = 0
        skipped = 0
        for place in qs.iterator():
            est = estimate_bortle(place.lat, place.lon)
            if est is None:
                self.stderr.write(self.style.WARNING(f"  ! {place.slug}: GIBS fetch failed"))
                skipped += 1
                time.sleep(sleep)
                continue
            old = place.bortle_class
            self.stdout.write(
                f"  {place.slug:40s}  {old}  →  {est.bortle_class}  (lum={est.luminance:.1f})"
            )
            if not dry_run:
                place.bortle_class = est.bortle_class
                place.save(update_fields=["bortle_class"])
            ok += 1
            time.sleep(sleep)

        self.stdout.write(self.style.SUCCESS(f"Done. updated={ok} skipped={skipped} total={total}"))
