from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from accounts.models import EmployeeProfile
from accounts.roles import UserRole
from audit.services import log_event
from assignments.models import WorkAssignment, WorkUpdate
from complaints.models import Complaint
from complaints.services import actor_can_manage_complaint, transition_complaint
from notifications.services import create_notification, notify_complaint_stakeholders


def _require_manager(actor, complaint):
    if not actor_can_manage_complaint(actor, complaint):
        raise ValidationError("You cannot manage assignments for this complaint.")


def _active_employee(employee, complaint):
    if employee.role != UserRole.EMPLOYEE or not employee.is_active:
        raise ValidationError({"employee_id": "Choose an active employee account."})
    try:
        profile = employee.employee_profile
    except EmployeeProfile.DoesNotExist as exc:
        raise ValidationError({"employee_id": "The selected account has no employee profile."}) from exc
    if complaint.department_id is None:
        raise ValidationError({"department": "Route this complaint to a department before assigning work."})
    if profile.department_id != complaint.department_id:
        raise ValidationError({"employee_id": "Employees can receive work only from their own department."})
    return profile


@transaction.atomic
def assign_complaint(*, complaint, actor, employee, due_at=None, override_reason=""):
    complaint = Complaint.objects.select_for_update().select_related("department").get(pk=complaint.pk)
    _require_manager(actor, complaint)
    profile = getattr(employee, "employee_profile", None)
    if (
        actor.role == UserRole.SUPER_ADMIN
        and profile
        and complaint.department_id
        and profile.department_id != complaint.department_id
    ):
        if not override_reason.strip():
            raise ValidationError({"reason": "A reason is required for a cross-department assignment."})
        reassign_complaint_department(
            complaint=complaint,
            actor=actor,
            department=profile.department,
            reason=override_reason,
        )
        complaint.refresh_from_db()
    _active_employee(employee, complaint)
    if complaint.status in (Complaint.Status.RESOLVED, Complaint.Status.CLOSED):
        raise ValidationError({"status": "Resolved or closed complaints cannot be assigned."})

    current = WorkAssignment.objects.select_for_update().filter(complaint=complaint, is_current=True).first()
    if current and current.employee_id == employee.pk:
        if due_at is not None and current.due_at != due_at:
            current.due_at = due_at
            current.save(update_fields=["due_at"])
        return current

    old_employee = current.employee if current else None
    if current:
        current.is_current = False
        current.status = WorkAssignment.Status.REASSIGNED
        current.save(update_fields=["is_current", "status"])

    assignment = WorkAssignment.objects.create(
        complaint=complaint,
        employee=employee,
        assigned_by=actor,
        reassigned_from=current,
        due_at=due_at or complaint.due_at,
    )
    complaint.assigned_employee = employee
    complaint.save(update_fields=["assigned_employee", "updated_at"])
    if complaint.status == Complaint.Status.SUBMITTED:
        transition_complaint(
            complaint=complaint,
            actor=actor,
            new_status=Complaint.Status.ASSIGNED,
            note="Work assigned to a department employee.",
        )
    log_event(
        actor=actor,
        action="EMPLOYEE_REASSIGNED" if current else "EMPLOYEE_ASSIGNED",
        complaint=complaint,
        previous_value={"employee_id": old_employee.pk if old_employee else None},
        new_value={"employee_id": employee.pk},
        metadata={"assignment_id": assignment.pk, "due_at": assignment.due_at.isoformat() if assignment.due_at else None},
    )
    notify_complaint_stakeholders(
        complaint=complaint,
        actor=actor,
        kind="ASSIGNMENT_REASSIGNED" if current else "NEW_ASSIGNMENT",
        title="Complaint work assigned",
        message=f"{complaint.complaint_id} was assigned to {employee.name}.",
    )
    if old_employee and old_employee.pk != getattr(actor, "pk", None):
        create_notification(
            recipient=old_employee,
            actor=actor,
            complaint=complaint,
            kind="ASSIGNMENT_REASSIGNED",
            title="Assignment reassigned",
            message=f"Work on {complaint.complaint_id} was reassigned to {employee.name}.",
        )
    return assignment


@transaction.atomic
def reassign_complaint_department(*, complaint, actor, department, reason):
    if actor.role != UserRole.SUPER_ADMIN:
        raise ValidationError("Only a Super Admin can reassign a complaint between departments.")
    if not department.is_active:
        raise ValidationError({"department_id": "Complaints can be routed only to an active department."})
    if complaint.status == Complaint.Status.CLOSED:
        raise ValidationError({"status": "Closed complaints cannot be reassigned."})
    old_department = complaint.department
    if old_department and old_department.pk == department.pk:
        return complaint

    current = WorkAssignment.objects.select_for_update().filter(
        complaint=complaint,
        is_current=True,
    ).first()
    if current:
        current.is_current = False
        current.status = WorkAssignment.Status.REASSIGNED
        current.save(update_fields=["is_current", "status"])
    old_employee_id = complaint.assigned_employee_id
    complaint.department = department
    complaint.assigned_employee = None
    complaint.save(update_fields=["department", "assigned_employee", "updated_at"])
    log_event(
        actor=actor,
        action="DEPARTMENT_REASSIGNED",
        complaint=complaint,
        previous_value={
            "department_id": old_department.pk if old_department else None,
            "employee_id": old_employee_id,
        },
        new_value={"department_id": department.pk, "employee_id": None},
        metadata={"reason": reason.strip()},
    )
    notify_complaint_stakeholders(
        complaint=complaint,
        actor=actor,
        kind="DEPARTMENT_REASSIGNED",
        title="Complaint moved to another department",
        message=f"{complaint.complaint_id} was moved to {department.name}.",
    )
    old_employee = current.employee if current else None
    if old_employee and old_employee.pk != getattr(actor, "pk", None):
        create_notification(
            recipient=old_employee,
            actor=actor,
            complaint=complaint,
            kind="ASSIGNMENT_REASSIGNED",
            title="Assignment moved to another department",
            message=f"Work on {complaint.complaint_id} was transferred to another department.",
        )
    return complaint


@transaction.atomic
def accept_assignment(*, assignment, actor):
    assignment = WorkAssignment.objects.select_for_update().select_related("complaint", "employee").get(pk=assignment.pk)
    if assignment.employee_id != actor.pk or not assignment.is_current:
        raise ValidationError("This assignment is not available to your account.")
    if assignment.status != WorkAssignment.Status.ASSIGNED:
        raise ValidationError({"status": "Only new assignments can be accepted."})
    assignment.status = WorkAssignment.Status.ACCEPTED
    assignment.accepted_at = timezone.now()
    assignment.save(update_fields=["status", "accepted_at"])
    if assignment.complaint.status == Complaint.Status.ASSIGNED:
        transition_complaint(
            complaint=assignment.complaint,
            actor=actor,
            new_status=Complaint.Status.ACCEPTED,
            note="Employee accepted the assignment.",
        )
    log_event(
        actor=actor,
        action="ASSIGNMENT_ACCEPTED",
        complaint=assignment.complaint,
        new_value={"assignment_id": assignment.pk, "employee_id": actor.pk},
    )
    notify_complaint_stakeholders(
        complaint=assignment.complaint,
        actor=actor,
        kind="ASSIGNMENT_ACCEPTED",
        title="Assignment accepted",
        message=f"{actor.name} accepted work on {assignment.complaint.complaint_id}.",
    )
    return assignment


@transaction.atomic
def update_assignment_progress(*, assignment, actor, note, progress_percent=None):
    assignment = WorkAssignment.objects.select_for_update().select_related("complaint", "employee").get(pk=assignment.pk)
    if assignment.employee_id != actor.pk or not assignment.is_current:
        raise ValidationError("This assignment is not available to your account.")
    if assignment.status not in (WorkAssignment.Status.ACCEPTED, WorkAssignment.Status.IN_PROGRESS):
        raise ValidationError({"status": "Accept the assignment before recording work progress."})
    if not note.strip() and progress_percent is None:
        raise ValidationError({"note": "Add a work note or progress percentage."})
    if assignment.status == WorkAssignment.Status.ACCEPTED:
        assignment.status = WorkAssignment.Status.IN_PROGRESS
        assignment.started_at = timezone.now()
        assignment.save(update_fields=["status", "started_at"])
        if assignment.complaint.status == Complaint.Status.ACCEPTED:
            transition_complaint(
                complaint=assignment.complaint,
                actor=actor,
                new_status=Complaint.Status.IN_PROGRESS,
                note="Employee started work.",
            )
    update = WorkUpdate.objects.create(
        assignment=assignment,
        actor=actor,
        note=note.strip(),
        progress_percent=progress_percent,
    )
    log_event(
        actor=actor,
        action="WORK_PROGRESS_UPDATED",
        complaint=assignment.complaint,
        new_value={"progress_percent": progress_percent, "note": note.strip()},
        metadata={"assignment_id": assignment.pk},
    )
    return update


@transaction.atomic
def complete_assignment(*, assignment, actor, note=""):
    assignment = WorkAssignment.objects.select_for_update().select_related("complaint", "employee").get(pk=assignment.pk)
    if assignment.employee_id != actor.pk or not assignment.is_current:
        raise ValidationError("This assignment is not available to your account.")
    if assignment.status not in (WorkAssignment.Status.ACCEPTED, WorkAssignment.Status.IN_PROGRESS):
        raise ValidationError({"status": "Only accepted or in-progress work can be marked complete."})
    assignment.status = WorkAssignment.Status.COMPLETED
    assignment.completed_at = timezone.now()
    assignment.save(update_fields=["status", "completed_at"])
    WorkUpdate.objects.create(
        assignment=assignment,
        actor=actor,
        progress_percent=100,
        note=note.strip() or "Employee marked the work complete.",
    )
    if assignment.complaint.status != Complaint.Status.WORK_COMPLETED:
        transition_complaint(
            complaint=assignment.complaint,
            actor=actor,
            new_status=Complaint.Status.WORK_COMPLETED,
            note=note.strip() or "Employee marked the work complete; administrator verification is pending.",
        )
    log_event(
        actor=actor,
        action="WORK_COMPLETED",
        complaint=assignment.complaint,
        new_value={"assignment_id": assignment.pk, "employee_id": actor.pk},
    )
    notify_complaint_stakeholders(
        complaint=assignment.complaint,
        actor=actor,
        kind="WORK_COMPLETED",
        title="Work completed, verification needed",
        message=f"{assignment.complaint.complaint_id} is ready for department admin verification.",
    )
    return assignment


@transaction.atomic
def verify_assignment(*, assignment, actor, resolution):
    assignment = WorkAssignment.objects.select_for_update().select_related("complaint", "complaint__department").get(pk=assignment.pk)
    _require_manager(actor, assignment.complaint)
    if not assignment.is_current or assignment.status != WorkAssignment.Status.COMPLETED:
        raise ValidationError({"status": "Only current completed work can be verified."})
    if not resolution.strip():
        raise ValidationError({"resolution": "A resolution is required to verify completed work."})
    from complaints.services import save_resolution

    save_resolution(complaint=assignment.complaint, actor=actor, resolution=resolution)
    transition_complaint(
        complaint=assignment.complaint,
        actor=actor,
        new_status=Complaint.Status.RESOLVED,
        note="Department administrator verified the completed work.",
    )
    assignment.status = WorkAssignment.Status.VERIFIED
    assignment.verified_at = timezone.now()
    assignment.save(update_fields=["status", "verified_at"])
    log_event(
        actor=actor,
        action="WORK_VERIFIED",
        complaint=assignment.complaint,
        new_value={"assignment_id": assignment.pk},
    )
    return assignment


def create_work_evidence(*, assignment, actor, uploaded_file):
    if assignment.employee_id != actor.pk or not assignment.is_current:
        raise ValidationError("Evidence can be added only to your current assignment.")
    from assignments.models import WorkEvidence

    evidence = WorkEvidence.objects.create(
        assignment=assignment,
        uploaded_by=actor,
        file=uploaded_file,
        original_name=uploaded_file.name[:255],
        content_type=getattr(uploaded_file, "content_type", "") or "",
        size_bytes=uploaded_file.size,
    )
    log_event(
        actor=actor,
        action="WORK_EVIDENCE_ADDED",
        complaint=assignment.complaint,
        metadata={"assignment_id": assignment.pk, "name": evidence.original_name},
    )
    return evidence
