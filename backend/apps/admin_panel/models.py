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

    class LightPollutionSource(models.TextChoices):
        BLACK_MARBLE_2016 = "black_marble_2016", "NASA Black Marble 2016 (static)"
        VIIRS_DNB_LATEST = "viirs_dnb_latest", "VIIRS DNB latest (manual refresh)"

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

    # ---- Light pollution overlay ----
    light_pollution_source = models.CharField(
        max_length=20,
        choices=LightPollutionSource.choices,
        default=LightPollutionSource.BLACK_MARBLE_2016,
    )
    light_pollution_dnb_date = models.CharField(
        max_length=10,
        blank=True,
        help_text="YYYY-MM-DD of the active VIIRS DNB nightly composite",
    )
    light_pollution_last_check = models.DateTimeField(null=True, blank=True)
    light_pollution_status_message = models.TextField(blank=True)

    # Local tile cache per source (Black Marble static + VIIRS DNB nightly).
    # When tile_count > 0 the frontend uses /lp-tiles/{source}/... instead
    # of querying NASA GIBS directly.
    light_pollution_black_marble_status = models.CharField(
        max_length=10, choices=JobStatus.choices, default=JobStatus.IDLE
    )
    light_pollution_black_marble_status_message = models.TextField(blank=True)
    light_pollution_black_marble_tile_count = models.PositiveIntegerField(default=0)
    light_pollution_black_marble_size_bytes = models.BigIntegerField(default=0)
    light_pollution_black_marble_last_update = models.DateTimeField(null=True, blank=True)

    light_pollution_viirs_dnb_status = models.CharField(
        max_length=10, choices=JobStatus.choices, default=JobStatus.IDLE
    )
    light_pollution_viirs_dnb_status_message = models.TextField(blank=True)
    light_pollution_viirs_dnb_tile_count = models.PositiveIntegerField(default=0)
    light_pollution_viirs_dnb_size_bytes = models.BigIntegerField(default=0)
    light_pollution_viirs_dnb_last_update = models.DateTimeField(null=True, blank=True)
    # Records which date the DNB cache was built for, so we can re-fetch
    # if the admin clicks "Aktualizovat na poslední" and a newer date is available.
    light_pollution_viirs_dnb_cached_date = models.CharField(
        max_length=10, blank=True
    )

    # ---- Chat settings ----
    # Soft per-message length limit (in characters of cleaned HTML).
    # Editable from admin UI; only enforced on new posts, never applied
    # retroactively to existing chat_message rows.
    chat_text_max_length = models.PositiveIntegerField(default=5000)

    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "admin_map_infra"

    def __str__(self) -> str:
        return f"MapInfra(tiles={self.tile_backend}, search={self.search_backend})"

    @classmethod
    def get(cls) -> "MapInfra":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj
