from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q


class WorkAssignment(models.Model):
    class Status(models.TextChoices):
        ASSIGNED = "ASSIGNED", "Assigned"
        ACCEPTED = "ACCEPTED", "Accepted"
        IN_PROGRESS = "IN_PROGRESS", "In progress"
        COMPLETED = "COMPLETED", "Completed"
        VERIFIED = "VERIFIED", "Verified"
        REASSIGNED = "REASSIGNED", "Reassigned"
        CANCELED = "CANCELED", "Canceled"

    complaint = models.ForeignKey(
        "complaints.Complaint",
        on_delete=models.PROTECT,
        related_name="assignments",
    )
    employee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="work_assignments",
    )
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="created_work_assignments",
    )
    reassigned_from = models.ForeignKey(
        "self",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="reassignment_successors",
    )
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ASSIGNED)
    is_current = models.BooleanField(default=True)
    due_at = models.DateTimeField(null=True, blank=True)
    assigned_at = models.DateTimeField(auto_now_add=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    verified_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-assigned_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["complaint"],
                condition=Q(is_current=True),
                name="one_current_assignment_per_complaint",
            ),
        ]
        indexes = [
            models.Index(fields=["employee", "status", "is_current"]),
            models.Index(fields=["due_at", "status"]),
        ]

    def __str__(self):
        return f"{self.complaint.complaint_id} → {self.employee.email} ({self.status})"


class WorkUpdate(models.Model):
    assignment = models.ForeignKey(WorkAssignment, on_delete=models.PROTECT, related_name="updates")
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="work_updates",
    )
    progress_percent = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(100)],
    )
    note = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]


class WorkEvidence(models.Model):
    assignment = models.ForeignKey(WorkAssignment, on_delete=models.PROTECT, related_name="evidence")
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="work_evidence_uploads",
    )
    file = models.FileField(upload_to="work-evidence/%Y/%m/")
    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=120, blank=True)
    size_bytes = models.PositiveBigIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
