import uuid
from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from accounts.roles import UserRole
from audit.services import log_event
from complaints.models import (
    CategoryDepartmentMapping,
    Complaint,
    ComplaintStatusHistory,
    PriorityPolicy,
)
from complaints.priority import assess_priority
from notifications.services import notify_complaint_stakeholders, notify_unassigned_review


def generate_complaint_id():
    stamp = timezone.now().strftime("%Y%m%d")
    return f"CMP-{stamp}-{uuid.uuid4().hex[:8].upper()}"


def category_mapping_for(category):
    return CategoryDepartmentMapping.objects.select_related("department").filter(
        category__iexact=category.strip(),
    ).first()


def _status_history(*, complaint, actor, previous_status, new_status, note="", metadata=None):
    return ComplaintStatusHistory.objects.create(
        complaint=complaint,
        actor=actor,
        actor_role=getattr(actor, "role", "") if actor else "SYSTEM",
        previous_status=previous_status or "",
        new_status=new_status,
        note=note,
        metadata=metadata or {},
    )


@transaction.atomic
def create_complaint(*, actor, title, description, category):
    mapping = category_mapping_for(category)
    if mapping and not mapping.is_active:
        raise ValidationError({"category": "This complaint category is not currently accepting submissions."})
    assessment = assess_priority(title, description, category)
    policy = PriorityPolicy.active()
    due_hours = {
        Complaint.Priority.LOW: policy.low_due_hours,
        Complaint.Priority.MEDIUM: policy.medium_due_hours,
        Complaint.Priority.HIGH: policy.high_due_hours,
        Complaint.Priority.CRITICAL: policy.critical_due_hours,
    }[assessment["priority"]]
    complaint = Complaint.objects.create(
        complaint_id=generate_complaint_id(),
        submitted_by=actor,
        title=title.strip(),
        description=description.strip(),
        category=category.strip(),
        category_mapping=mapping,
        department=(
            mapping.department
            if mapping and mapping.department and mapping.department.is_active
            else None
        ),
        status=Complaint.Status.SUBMITTED,
        priority=assessment["priority"],
        priority_score=assessment["score"],
        priority_reason=assessment["reasons"],
        due_at=timezone.now() + timedelta(hours=due_hours),
    )
    _status_history(
        complaint=complaint,
        actor=actor,
        previous_status="",
        new_status=complaint.status,
        note="Complaint submitted.",
    )
    log_event(
        actor=actor,
        action="COMPLAINT_CREATED",
        complaint=complaint,
        new_value={"status": complaint.status, "priority": complaint.priority},
        metadata={"category": complaint.category},
    )
    if complaint.department_id:
        notify_complaint_stakeholders(
            complaint=complaint,
            actor=actor,
            kind="NEW_COMPLAINT",
            title="New department complaint",
            message=f"{complaint.complaint_id} was routed to {complaint.department.name}.",
            include_assignee=False,
        )
    else:
        notify_unassigned_review(complaint=complaint, actor=actor)
    return complaint


@transaction.atomic
def update_complaint(*, complaint, actor, changes):
    if actor.role == UserRole.USER and complaint.status != Complaint.Status.SUBMITTED:
        raise ValidationError({"detail": "Only submitted complaints can be edited by their owner."})
    old_department = complaint.department
    old_category = complaint.category
    old_priority = complaint.priority
    old_title = complaint.title
    old_description = complaint.description

    for field in ("title", "description", "category"):
        if field in changes:
            setattr(complaint, field, changes[field].strip())
    if "category" in changes:
        mapping = category_mapping_for(complaint.category)
        if mapping and not mapping.is_active:
            raise ValidationError({"category": "This complaint category is not currently accepting submissions."})
        complaint.category_mapping = mapping
        complaint.department = (
            mapping.department
            if mapping and mapping.department and mapping.department.is_active
            else None
        )
    assessment = assess_priority(complaint.title, complaint.description, complaint.category)
    safety_was_critical = old_priority == Complaint.Priority.CRITICAL and any(
        "critical safety trigger" in str(item).casefold()
        for item in complaint.priority_reason
    )
    if safety_was_critical and assessment["priority"] != Complaint.Priority.CRITICAL:
        assessment["priority"] = Complaint.Priority.CRITICAL
        assessment["score"] = max(assessment["score"], 76)
        assessment["reasons"].append("Critical safety priority retained after complaint edit.")
    complaint.priority = assessment["priority"]
    complaint.priority_score = assessment["score"]
    complaint.priority_reason = assessment["reasons"]
    complaint.save()

    if any((old_title != complaint.title, old_description != complaint.description, old_category != complaint.category)):
        log_event(
            actor=actor,
            action="COMPLAINT_UPDATED",
            complaint=complaint,
            previous_value={"title": old_title, "description": old_description, "category": old_category,
                            "department_id": getattr(old_department, "pk", None)},
            new_value={"title": complaint.title, "description": complaint.description, "category": complaint.category,
                       "department_id": complaint.department_id},
        )
    if old_category != complaint.category:
        if old_department != complaint.department:
            log_event(
                actor=actor,
                action="DEPARTMENT_REASSIGNED",
                complaint=complaint,
                previous_value={"department_id": getattr(old_department, "pk", None)},
                new_value={"department_id": complaint.department_id},
            )
            if complaint.department_id:
                notify_complaint_stakeholders(
                    complaint=complaint,
                    actor=actor,
                    kind="DEPARTMENT_ROUTED",
                    title="Complaint department updated",
                    message=f"{complaint.complaint_id} was routed to {complaint.department.name}.",
                )
            else:
                notify_unassigned_review(complaint=complaint, actor=actor)
    if old_priority != complaint.priority:
        log_event(
            actor=actor,
            action="PRIORITY_CHANGED",
            complaint=complaint,
            previous_value={"priority": old_priority},
            new_value={"priority": complaint.priority, "score": complaint.priority_score},
        )
    return complaint


@transaction.atomic
def override_priority(*, complaint, actor, priority, reason):
    old_priority = complaint.priority
    if old_priority == priority:
        return complaint
    safety_triggered = any(
        "critical safety trigger" in str(item).casefold()
        for item in complaint.priority_reason
    )
    severity_order = {
        Complaint.Priority.LOW: 0,
        Complaint.Priority.MEDIUM: 1,
        Complaint.Priority.HIGH: 2,
        Complaint.Priority.CRITICAL: 3,
    }
    downgrade = severity_order[priority] < severity_order[old_priority]
    if safety_triggered and downgrade and actor.role != UserRole.SUPER_ADMIN:
        raise ValidationError({"priority": "Only a Super Admin can override a critical safety complaint downward."})
    if not reason.strip():
        raise ValidationError({"reason": "A reason is required for every priority override."})

    complaint.priority = priority
    complaint.priority_overridden = True
    complaint.priority_reason = [*complaint.priority_reason, f"Administrator override: {reason.strip()}"]
    complaint.save(update_fields=["priority", "priority_overridden", "priority_reason", "updated_at"])
    log_event(
        actor=actor,
        action="PRIORITY_OVERRIDDEN",
        complaint=complaint,
        previous_value={"priority": old_priority},
        new_value={"priority": priority},
        metadata={"reason": reason.strip(), "safety_triggered": safety_triggered},
    )
    notify_complaint_stakeholders(
        complaint=complaint,
        actor=actor,
        kind="PRIORITY_CHANGED",
        title="Complaint priority updated",
        message=f"Priority for {complaint.complaint_id} was changed to {priority.lower()}.",
    )
    return complaint


STATUS_TRANSITIONS = {
    Complaint.Status.SUBMITTED: {Complaint.Status.ASSIGNED, Complaint.Status.IN_PROGRESS},
    Complaint.Status.ASSIGNED: {Complaint.Status.ACCEPTED, Complaint.Status.IN_PROGRESS},
    Complaint.Status.ACCEPTED: {Complaint.Status.IN_PROGRESS, Complaint.Status.WORK_COMPLETED},
    Complaint.Status.IN_PROGRESS: {Complaint.Status.WORK_COMPLETED, Complaint.Status.RESOLVED},
    Complaint.Status.WORK_COMPLETED: {Complaint.Status.RESOLVED},
    Complaint.Status.RESOLVED: {Complaint.Status.CLOSED},
    Complaint.Status.CLOSED: set(),
}


@transaction.atomic
def transition_complaint(*, complaint, actor, new_status, note="", metadata=None):
    if new_status == complaint.status:
        return complaint
    if new_status not in STATUS_TRANSITIONS.get(complaint.status, set()):
        raise ValidationError(
            {"status": f"Invalid status transition from '{complaint.status}' to '{new_status}'."}
        )
    if new_status in (Complaint.Status.RESOLVED, Complaint.Status.CLOSED) and not complaint.resolution.strip():
        raise ValidationError({"resolution": "A resolution is required before resolving or closing a complaint."})

    old_status = complaint.status
    complaint.status = new_status
    if new_status == Complaint.Status.RESOLVED:
        complaint.resolved_at = timezone.now()
    if new_status == Complaint.Status.CLOSED:
        complaint.closed_at = timezone.now()
    complaint.save()
    _status_history(
        complaint=complaint,
        actor=actor,
        previous_status=old_status,
        new_status=new_status,
        note=note,
        metadata=metadata,
    )
    action = "COMPLAINT_CLOSED" if new_status == Complaint.Status.CLOSED else "COMPLAINT_STATUS_CHANGED"
    log_event(
        actor=actor,
        action=action,
        complaint=complaint,
        previous_value={"status": old_status},
        new_value={"status": new_status},
        metadata=metadata,
    )
    notify_complaint_stakeholders(
        complaint=complaint,
        actor=actor,
        kind=new_status.upper().replace(" ", "_"),
        title=f"Complaint {new_status.lower()}",
        message=f"{complaint.complaint_id} is now {new_status.lower()}.",
    )
    return complaint


@transaction.atomic
def save_resolution(*, complaint, actor, resolution):
    if complaint.status == Complaint.Status.CLOSED:
        raise ValidationError({"resolution": "A closed complaint cannot be modified."})
    old_resolution = complaint.resolution
    complaint.resolution = resolution.strip()
    complaint.save(update_fields=["resolution", "updated_at"])
    action = "RESOLUTION_UPDATED" if old_resolution else "RESOLUTION_ADDED"
    log_event(
        actor=actor,
        action=action,
        complaint=complaint,
        previous_value={"resolution": old_resolution},
        new_value={"resolution": complaint.resolution},
    )
    notify_complaint_stakeholders(
        complaint=complaint,
        actor=actor,
        kind="RESOLUTION_UPDATED",
        title="Complaint resolution updated",
        message=f"A resolution was saved for {complaint.complaint_id}.",
    )
    return complaint


@transaction.atomic
def reopen_complaint(*, complaint, actor, reason):
    if complaint.status != Complaint.Status.CLOSED:
        raise ValidationError({"status": "Only closed complaints can be reopened."})
    old_status = complaint.status
    complaint.status = Complaint.Status.IN_PROGRESS
    complaint.closed_at = None
    complaint.resolved_at = None
    complaint.save(update_fields=["status", "closed_at", "resolved_at", "updated_at"])
    _status_history(
        complaint=complaint,
        actor=actor,
        previous_status=old_status,
        new_status=complaint.status,
        note=reason.strip(),
        metadata={"reopened": True},
    )
    log_event(
        actor=actor,
        action="COMPLAINT_REOPENED",
        complaint=complaint,
        previous_value={"status": old_status},
        new_value={"status": complaint.status},
        metadata={"reason": reason.strip()},
    )
    notify_complaint_stakeholders(
        complaint=complaint,
        actor=actor,
        kind="COMPLAINT_REOPENED",
        title="Complaint reopened",
        message=f"{complaint.complaint_id} was reopened for additional work.",
    )
    return complaint


def actor_can_manage_complaint(actor, complaint):
    if actor.role == UserRole.SUPER_ADMIN:
        return True
    if actor.role == UserRole.DEPARTMENT_ADMIN:
        profile = getattr(actor, "department_admin_profile", None)
        return bool(profile and complaint.department_id == profile.department_id)
    return False
