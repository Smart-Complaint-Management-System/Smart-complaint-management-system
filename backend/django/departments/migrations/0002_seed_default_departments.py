from django.db import migrations


DEFAULT_DEPARTMENTS = [
    ("electrical", "Electrical", "Electrical services and repairs."),
    ("plumbing", "Plumbing", "Water supply, drainage, and plumbing."),
    ("civil", "Civil", "Civil works and building maintenance."),
    ("networking", "Networking", "Network and connectivity services."),
    ("housekeeping", "Housekeeping", "Cleaning and housekeeping services."),
]


def add_default_departments(apps, schema_editor):
    Department = apps.get_model("departments", "Department")
    database = schema_editor.connection.alias
    for identifier, name, description in DEFAULT_DEPARTMENTS:
        Department.objects.using(database).get_or_create(
            identifier=identifier,
            defaults={"name": name, "description": description},
        )


class Migration(migrations.Migration):
    dependencies = [("departments", "0001_initial")]

    operations = [
        migrations.RunPython(add_default_departments, migrations.RunPython.noop),
    ]
