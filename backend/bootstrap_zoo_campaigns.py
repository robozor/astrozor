"""One-shot bootstrap: open a 3-month Astrozor campaign per catalogued
Zooniverse project so the calendar + project-detail surfaces have data
to render. Re-runnable — campaigns already linked to a Zooniverse
project are left alone.

Run via::

    docker exec astrozor-api python /app/backend/bootstrap_zoo_campaigns.py
"""
from __future__ import annotations

import os
import sys
from datetime import timedelta

# Bootstrap Django so this file can run as a plain script.
sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "astrozor.settings")

import django

django.setup()

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from django.utils.text import slugify

from apps.citizen.models import Campaign, ZooniverseProject
from apps.projects.models import Project

User = get_user_model()


def main() -> int:
    admin = User.objects.filter(is_staff=True).order_by("created_at").first()
    if not admin:
        print("No staff user found", file=sys.stderr)
        return 1

    with transaction.atomic():
        parent, parent_created = Project.objects.get_or_create(
            slug="citizen-science",
            defaults={
                "name": "Citizen Science",
                "description": "Astrozor sprinty navázané na Zooniverse projekty.",
                "visibility": "public",
                "created_by": admin,
            },
        )
        print(f"umbrella project: {parent.slug} (created={parent_created})")

        now = timezone.now()
        end = now + timedelta(days=90)
        created, skipped = 0, 0

        for zp in ZooniverseProject.objects.order_by("zooniverse_id"):
            if Campaign.objects.filter(zooniverse_project=zp).exists():
                print(f"  skip #{zp.zooniverse_id} {zp.title}: already has campaign(s)")
                skipped += 1
                continue

            base_slug = slugify(zp.title)[:100] or f"zoo-{zp.zooniverse_id}"
            slug = f"zoo-{zp.zooniverse_id}-{base_slug}"[:160]

            first_active = next(
                (w for w in (zp.workflows or []) if w.get("active")), None
            )
            wid = first_active.get("id") if first_active else None
            workflow_label = (
                first_active.get("display_name", "") if first_active else ""
            )

            title = f"{zp.title} - Astrozor sprint"
            desc_lines = [
                f"Klasifikuj snimky projektu {zp.title} pod skupinou Astrozor.",
            ]
            if workflow_label:
                desc_lines.append(f"Hlavni uloha: {workflow_label}.")
            desc_lines += [
                "",
                "Tato kampan je 3-mesicni sprint Astrozor komunity - vase klasifikace",
                "se zapocitaji do skupinovych statistik. Staci byt prihlaseny a propojeny",
                "s Zooniverse uctem v Nastaveni.",
            ]
            c = Campaign.objects.create(
                project=parent,
                slug=slug,
                title=title,
                description="\n".join(desc_lines),
                kind=Campaign.Kind.OTHER,
                status=Campaign.Status.OPEN,
                coordinator=admin,
                starts_at=now,
                ends_at=end,
                zooniverse_project=zp,
                zooniverse_workflow_id=wid,
            )
            print(f"  created #{zp.zooniverse_id} -> {c.slug}")
            created += 1

    print()
    print(f"Summary: created={created} skipped={skipped}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
