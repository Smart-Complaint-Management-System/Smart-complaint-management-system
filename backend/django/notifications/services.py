from django.contrib.auth import get_user_model

from accounts.models import DepartmentAdminProfile
from accounts.roles import UserRole
from notifications.models import Notification

User = get_user_model()


def create_notification(*, recipient, actor, complaint, kind, title, message):
    if recipient is None:
        return None
    return Notification.objects.create(
        recipient=recipient,
        actor=actor,
        complaint=complaint,
        kind=kind,
        title=title,
        message=message[:500],
    )


def notify_complaint_stakeholders(*, complaint, actor, kind, title, message, include_department_admins=True, include_submitter=True, include_assignee=True):
    recipient_ids = set()
    if include_submitter:
        recipient_ids.add(complaint.submitted_by_id)
    if include_assignee and complaint.assigned_employee_id:
        recipient_ids.add(complaint.assigned_employee_id)
    if include_department_admins and complaint.department_id:
        recipient_ids.update(
            DepartmentAdminProfile.objects.filter(
                department_id=complaint.department_id,
                user__is_active=True,
            ).values_list("user_id", flat=True)
        )
    recipient_ids.discard(getattr(actor, "pk", None))
    recipients = User.objects.filter(pk__in=recipient_ids, is_active=True)
    return [
        create_notification(
            recipient=recipient,
            actor=actor,
            complaint=complaint,
            kind=kind,
            title=title,
            message=message,
        )
        for recipient in recipients
    ]


def notify_unassigned_review(*, complaint, actor):
    super_admins = User.objects.filter(role=UserRole.SUPER_ADMIN, is_active=True)
    return [
        create_notification(
            recipient=recipient,
            actor=actor,
            complaint=complaint,
            kind="UNASSIGNED_REVIEW",
            title="Complaint needs department review",
            message=f"{complaint.complaint_id} could not be routed to a department.",
        )
        for recipient in super_admins.exclude(pk=getattr(actor, "pk", None))
    ]
