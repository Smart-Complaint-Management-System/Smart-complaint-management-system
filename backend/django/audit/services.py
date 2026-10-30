from audit.models import AuditEvent
from accounts.roles import department_for_user


def log_event(
    *,
    actor=None,
    action,
    complaint=None,
    department=None,
    previous_value=None,
    new_value=None,
    metadata=None,
):
    return AuditEvent.objects.create(
        actor=actor,
        actor_role=getattr(actor, "role", "") if actor else "SYSTEM",
        action=action,
        complaint=complaint,
        department=department or getattr(complaint, "department", None) or (department_for_user(actor) if actor else None),
        previous_value=previous_value or {},
        new_value=new_value or {},
        metadata=metadata or {},
    )
