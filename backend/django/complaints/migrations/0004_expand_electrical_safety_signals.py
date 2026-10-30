from django.db import migrations


def add_electrical_signals(apps, schema_editor):
    Policy = apps.get_model("complaints", "PriorityPolicy")
    policy = Policy.objects.using(schema_editor.connection.alias).filter(pk=1).first()
    if policy:
        signals = list(policy.safety_keywords or [])
        for signal in ("exposed live wiring", "exposed electrical wiring", "live electrical wiring", "electrical wiring"):
            if signal not in signals:
                signals.append(signal)
        policy.safety_keywords = signals
        policy.save(update_fields=["safety_keywords"])


class Migration(migrations.Migration):
    dependencies = [("complaints", "0003_prioritypolicy_critical_due_hours_and_more")]
    operations = [migrations.RunPython(add_electrical_signals, migrations.RunPython.noop)]
