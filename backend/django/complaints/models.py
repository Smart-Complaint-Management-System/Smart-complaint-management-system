from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models.functions import Lower


class PriorityPolicy(models.Model):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    safety_weight = models.PositiveSmallIntegerField(default=40)
    affected_users_weight = models.PositiveSmallIntegerField(default=20)
    service_disruption_weight = models.PositiveSmallIntegerField(default=20)
    urgency_weight = models.PositiveSmallIntegerField(default=20)
    medium_threshold = models.PositiveSmallIntegerField(default=21)
    high_threshold = models.PositiveSmallIntegerField(default=46)
    critical_threshold = models.PositiveSmallIntegerField(default=76)
    low_due_hours = models.PositiveSmallIntegerField(default=168)
    medium_due_hours = models.PositiveSmallIntegerField(default=72)
    high_due_hours = models.PositiveSmallIntegerField(default=24)
    critical_due_hours = models.PositiveSmallIntegerField(default=4)
    safety_keywords = models.JSONField(default=list)
    affected_users_keywords = models.JSONField(default=list)
    disruption_keywords = models.JSONField(default=list)
    urgency_keywords = models.JSONField(default=list)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "priority policy"

    def clean(self):
        if self.pk != 1:
            raise ValidationError("Only one priority policy can exist.")
        weights = (
            self.safety_weight,
            self.affected_users_weight,
            self.service_disruption_weight,
            self.urgency_weight,
        )
        if sum(weights) != 100:
            raise ValidationError("Priority weights must add up to 100.")
        if not 1 <= self.medium_threshold < self.high_threshold < self.critical_threshold <= 100:
            raise ValidationError("Priority thresholds must be increasing values between 1 and 100.")

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    @classmethod
    def active(cls):
        policy = cls.objects.filter(pk=1).first()
        if policy:
            return policy
        return cls(pk=1)


class CategoryDepartmentMapping(models.Model):
    category = models.CharField(max_length=120)
    department = models.ForeignKey(
        "departments.Department",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="category_mappings",
        help_text="Leave blank to route matching complaints to the Super Admin review queue.",
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["category", "id"]
        constraints = [
            models.UniqueConstraint(Lower("category"), name="complaint_category_ci_uniq"),
        ]

    def save(self, *args, **kwargs):
        self.category = " ".join(self.category.split())
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.category} → {self.department or 'Unassigned review'}"


class Complaint(models.Model):
    class Status(models.TextChoices):
        SUBMITTED = "Submitted", "Submitted"
        ASSIGNED = "Assigned", "Assigned"
        ACCEPTED = "Accepted", "Accepted"
        IN_PROGRESS = "In Progress", "In Progress"
        WORK_COMPLETED = "Work Completed", "Work Completed"
        RESOLVED = "Resolved", "Resolved"
        CLOSED = "Closed", "Closed"

    class Priority(models.TextChoices):
        LOW = "LOW", "Low"
        MEDIUM = "MEDIUM", "Medium"
        HIGH = "HIGH", "High"
        CRITICAL = "CRITICAL", "Critical"

    complaint_id = models.CharField(max_length=32, unique=True, db_index=True)
    legacy_mongo_id = models.CharField(max_length=64, unique=True, null=True, blank=True)
    submitted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="submitted_complaints",
    )
    title = models.CharField(max_length=200)
    description = models.TextField(max_length=5000)
    category = models.CharField(max_length=120)
    category_mapping = models.ForeignKey(
        CategoryDepartmentMapping,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="complaints",
    )
    department = models.ForeignKey(
        "departments.Department",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="complaints",
    )
    status = models.CharField(max_length=24, choices=Status.choices, default=Status.SUBMITTED)
    priority = models.CharField(max_length=12, choices=Priority.choices, default=Priority.LOW)
    priority_score = models.PositiveSmallIntegerField(
        default=0,
        validators=[MinValueValidator(0), MaxValueValidator(100)],
    )
    priority_reason = models.JSONField(default=list, blank=True)
    priority_overridden = models.BooleanField(default=False)
    assigned_employee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="assigned_complaints",
    )
    resolution = models.CharField(max_length=2000, blank=True, default="")
    due_at = models.DateTimeField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["department", "status", "created_at"]),
            models.Index(fields=["assigned_employee", "status"]),
            models.Index(fields=["priority", "status"]),
            models.Index(fields=["submitted_by", "created_at"]),
        ]

    @property
    def unassigned(self):
        return self.department_id is None

    def __str__(self):
        return f"{self.complaint_id}: {self.title}"


class ComplaintStatusHistory(models.Model):
    complaint = models.ForeignKey(Complaint, on_delete=models.PROTECT, related_name="status_history")
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="complaint_status_changes",
    )
    actor_role = models.CharField(max_length=24, blank=True)
    previous_status = models.CharField(max_length=24, blank=True)
    new_status = models.CharField(max_length=24, choices=Complaint.Status.choices)
    note = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]


class ComplaintAttachment(models.Model):
    class Kind(models.TextChoices):
        SUBMISSION = "SUBMISSION", "Complaint attachment"
        WORK_EVIDENCE = "WORK_EVIDENCE", "Completion evidence"

    complaint = models.ForeignKey(Complaint, on_delete=models.PROTECT, related_name="attachments")
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="complaint_attachments",
    )
    file = models.FileField(upload_to="complaints/%Y/%m/")
    original_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=120, blank=True)
    size_bytes = models.PositiveBigIntegerField(default=0)
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.SUBMISSION)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
