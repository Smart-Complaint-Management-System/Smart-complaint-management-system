from django.db import migrations


DEFAULT_MAPPINGS = [
    ("Electrical", "electrical"),
    ("Plumbing", "plumbing"),
    ("Civil", "civil"),
    ("Infrastructure", "civil"),
    ("Furniture", "civil"),
    ("Networking", "networking"),
    ("Network / Wi-Fi", "networking"),
    ("Housekeeping", "housekeeping"),
    ("Hostel", "housekeeping"),
    ("Academic", None),
    ("Audio / Visual", None),
    ("Other", None),
]

DEFAULT_PRIORITY_POLICY = {
    "safety_weight": 40,
    "affected_users_weight": 20,
    "service_disruption_weight": 20,
    "urgency_weight": 20,
    "medium_threshold": 21,
    "high_threshold": 46,
    "critical_threshold": 76,
    "safety_keywords": [
        "exposed wiring", "exposed wire", "live wire", "sparking", "electric shock",
        "electrocution", "fire", "smoke", "gas leak", "structural collapse", "injury", "unsafe", "dangerous",
    ],
    "affected_users_keywords": ["whole building", "entire floor", "campus-wide", "multiple rooms"],
    "disruption_keywords": ["power outage", "water outage", "network outage", "no power", "no water", "service outage"],
    "urgency_keywords": ["immediate", "immediately", "urgent", "right now", "ongoing", "emergency", "cannot use"],
}


def seed_configuration(apps, schema_editor):
    Department = apps.get_model("departments", "Department")
    Mapping = apps.get_model("complaints", "CategoryDepartmentMapping")
    PriorityPolicy = apps.get_model("complaints", "PriorityPolicy")
    database = schema_editor.connection.alias
    departments = {
        department.identifier: department
        for department in Department.objects.using(database).all()
    }
    for category, identifier in DEFAULT_MAPPINGS:
        Mapping.objects.using(database).get_or_create(
            category=category,
            defaults={
                "department": departments.get(identifier) if identifier else None,
                "is_active": True,
            },
        )
    PriorityPolicy.objects.using(database).get_or_create(
        pk=1,
        defaults=DEFAULT_PRIORITY_POLICY,
    )


class Migration(migrations.Migration):
    dependencies = [
        ("complaints", "0001_initial"),
        ("departments", "0002_seed_default_departments"),
    ]

    operations = [migrations.RunPython(seed_configuration, migrations.RunPython.noop)]
