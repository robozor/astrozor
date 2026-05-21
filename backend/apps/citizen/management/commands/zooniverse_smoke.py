"""Smoke-test the Zooniverse Panoptes + ERAS clients.

Run after configuring ``.env`` (``ZOONIVERSE_OAUTH_CLIENT_ID`` /
``_SECRET`` / ``ZOONIVERSE_GROUP_ID``) to verify:

  1. Public ERAS endpoint reachable (project total for Galaxy Zoo).
  2. Panoptes project metadata works without auth.
  3. Group endpoint reachable (auth-gated bits only if
     ``ZOONIVERSE_SERVICE_ACCESS_TOKEN`` is set).

Usage::

    python manage.py zooniverse_smoke
    python manage.py zooniverse_smoke --project 5733
    python manage.py zooniverse_smoke --group 2914377

No DB writes, no model imports — pure HTTP round-trips.
"""

from __future__ import annotations

import os

from django.core.management.base import BaseCommand

from apps.citizen.zooniverse import (
    Eras,
    Panoptes,
    ZooniverseError,
    service_token,
)


class Command(BaseCommand):
    help = "Smoke-test the Zooniverse API clients (no DB writes)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--project",
            type=int,
            default=5733,
            help="Zooniverse project_id to probe (default: 5733 = Galaxy Zoo).",
        )
        parser.add_argument(
            "--group",
            type=int,
            default=int(os.environ.get("ZOONIVERSE_GROUP_ID") or 0),
            help="Zooniverse user_group id (default: $ZOONIVERSE_GROUP_ID).",
        )

    def handle(self, *args, **opts):
        project_id = opts["project"]
        group_id = opts["group"]
        token = service_token()

        self.stdout.write(self.style.MIGRATE_HEADING("\n[1/4] Panoptes — public project metadata"))
        p_anon = Panoptes(token=None)
        try:
            proj = p_anon.get_project(project_id)
            self.stdout.write(
                f"  ✓ project {project_id} = {proj.get('display_name')!r} "
                f"(slug={proj.get('slug')!r}, "
                f"classifications={proj.get('classifications_count')})"
            )
        except ZooniverseError as e:
            self.stderr.write(self.style.ERROR(f"  ✗ {e}"))

        self.stdout.write(self.style.MIGRATE_HEADING("\n[2/4] ERAS — public project totals"))
        eras_anon = Eras(token=None)
        try:
            total = eras_anon.project_total(project_id)
            self.stdout.write(f"  ✓ total_count = {total.get('total_count')}")
            day = eras_anon.project_total(project_id, period="day")
            data = day.get("data", [])
            self.stdout.write(f"  ✓ daily series — {len(data)} buckets, last={data[-1] if data else 'n/a'}")
        except ZooniverseError as e:
            self.stderr.write(self.style.ERROR(f"  ✗ {e}"))

        self.stdout.write(self.style.MIGRATE_HEADING("\n[3/4] Panoptes — group metadata"))
        if not group_id:
            self.stdout.write(self.style.WARNING("  ⊘ skipped — ZOONIVERSE_GROUP_ID not set"))
        else:
            p = Panoptes(token=token)
            try:
                group = p.get_group(group_id, include="users")
                members = (group.get("links") or {}).get("users") or []
                self.stdout.write(
                    f"  ✓ group {group_id} = {group.get('display_name')!r}, "
                    f"visibility={group.get('stats_visibility')!r}, "
                    f"members={len(members)}"
                )
                if group.get("join_token"):
                    masked = group["join_token"][:6] + "…"
                    self.stdout.write(f"  ✓ join_token = {masked} (use as ?join_token=… on /groups/{group_id}/join)")
            except ZooniverseError as e:
                self.stderr.write(self.style.ERROR(f"  ✗ {e}"))

        self.stdout.write(self.style.MIGRATE_HEADING("\n[4/4] ERAS — group totals"))
        if not group_id:
            self.stdout.write(self.style.WARNING("  ⊘ skipped — ZOONIVERSE_GROUP_ID not set"))
        else:
            try:
                # Public visibility groups: even anonymous works for aggregate.
                g = Eras(token=token).group_total(
                    group_id, top_contributors=5, individual_stats_breakdown=bool(token)
                )
                self.stdout.write(
                    f"  ✓ total_count = {g.get('total_count')}, "
                    f"active_users = {g.get('active_users')}, "
                    f"time_spent = {g.get('time_spent')}"
                )
                bd = g.get("group_member_stats_breakdown") or []
                if bd:
                    self.stdout.write(f"  ✓ top members: {bd[:3]}")
            except ZooniverseError as e:
                self.stderr.write(self.style.ERROR(f"  ✗ {e}"))

        self.stdout.write("\n" + self.style.SUCCESS("Smoke run complete."))
