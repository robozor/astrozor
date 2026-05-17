from __future__ import annotations

from django.db import models


class MapInfra(models.Model):
    """Singleton (pk=1) tracking the state of self-hosted map infra:

    * PMTiles Europe extract (replaces OSM raster as default tile source)
    * Photon search backend (replaces Nominatim for geocoding)

    Stored in DB rather than env so the admin UI can edit it without a
    container restart.
    """

    class TileBackend(models.TextChoices):
        OSM = "osm", "OSM"
        PMTILES = "pmtiles", "PMTiles (self-hosted)"

    class SearchBackend(models.TextChoices):
        NOMINATIM = "nominatim", "Nominatim (proxied)"
        PHOTON = "photon", "Photon (self-hosted)"

    class JobStatus(models.TextChoices):
        IDLE = "idle", "Idle"
        RUNNING = "running", "Running"
        ERROR = "error", "Error"

    id = models.PositiveSmallIntegerField(primary_key=True, default=1)

    # ---- PMTiles ----
    pmtiles_path = models.CharField(
        max_length=300, default="/var/lib/astrozor/pmtiles/europe.pmtiles"
    )
    pmtiles_source_url = models.URLField(
        max_length=500,
        default="",
        blank=True,
        help_text=(
            "Protomaps Daily build URL. Leave blank to auto-pick the latest "
            "from https://build-metadata.protomaps.dev/builds.json"
        ),
    )
    pmtiles_size_bytes = models.BigIntegerField(default=0)
    pmtiles_last_update = models.DateTimeField(null=True, blank=True)
    pmtiles_job_id = models.CharField(max_length=80, blank=True)
    pmtiles_status = models.CharField(
        max_length=10, choices=JobStatus.choices, default=JobStatus.IDLE
    )
    pmtiles_status_message = models.TextField(blank=True)

    # ---- Photon ----
    photon_url = models.URLField(max_length=300, default="http://photon:2322")
    photon_last_import = models.DateTimeField(null=True, blank=True)
    photon_status = models.CharField(
        max_length=10, choices=JobStatus.choices, default=JobStatus.IDLE
    )
    photon_status_message = models.TextField(blank=True)
    photon_imported_size_mb = models.BigIntegerField(default=0)

    # ---- Active backends ----
    tile_backend = models.CharField(
        max_length=10, choices=TileBackend.choices, default=TileBackend.OSM
    )
    search_backend = models.CharField(
        max_length=10, choices=SearchBackend.choices, default=SearchBackend.NOMINATIM
    )

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "admin_map_infra"

    def __str__(self) -> str:
        return f"MapInfra(tiles={self.tile_backend}, search={self.search_backend})"

    @classmethod
    def get(cls) -> "MapInfra":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj
