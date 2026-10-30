from pathlib import PurePosixPath

from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from accounts.models import User
from complaints.models import (
    CategoryDepartmentMapping,
    Complaint,
    ComplaintAttachment,
    ComplaintStatusHistory,
    PriorityPolicy,
)
from complaints.services import create_complaint, update_complaint
from departments.models import Department

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_UPLOAD_EXTENSIONS = {"jpg", "jpeg", "png", "pdf"}


class UserBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "name", "email", "role")


class StatusHistorySerializer(serializers.ModelSerializer):
    actor = UserBriefSerializer(read_only=True)
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = ComplaintStatusHistory
        fields = ("id", "actor", "actor_role", "previous_status", "new_status", "note", "metadata", "createdAt")


class AttachmentSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()
    uploadedBy = UserBriefSerializer(source="uploaded_by", read_only=True)
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = ComplaintAttachment
        fields = ("id", "url", "original_name", "content_type", "size_bytes", "kind", "uploadedBy", "createdAt")

    def get_url(self, attachment):
        request = self.context.get("request")
        url = attachment.file.url
        return request.build_absolute_uri(url) if request else url


class ComplaintReadSerializer(serializers.ModelSerializer):
    _id = serializers.CharField(source="pk", read_only=True)
    complaintId = serializers.CharField(source="complaint_id", read_only=True)
    submittedBy = UserBriefSerializer(source="submitted_by", read_only=True)
    assignedDepartment = serializers.SerializerMethodField()
    assignedEmployee = UserBriefSerializer(source="assigned_employee", read_only=True)
    priorityScore = serializers.IntegerField(source="priority_score", read_only=True)
    priorityReason = serializers.JSONField(source="priority_reason", read_only=True)
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)
    updatedAt = serializers.DateTimeField(source="updated_at", read_only=True)
    dueDate = serializers.DateTimeField(source="due_at", read_only=True)
    resolvedAt = serializers.DateTimeField(source="resolved_at", read_only=True)
    closedAt = serializers.DateTimeField(source="closed_at", read_only=True)
    statusHistory = StatusHistorySerializer(source="status_history", many=True, read_only=True)
    attachments = AttachmentSerializer(many=True, read_only=True)

    class Meta:
        model = Complaint
        fields = (
            "id", "_id", "complaintId", "title", "description", "category", "submittedBy",
            "assignedDepartment", "assignedEmployee", "priority", "priorityScore", "priorityReason",
            "priority_overridden", "status", "resolution", "dueDate", "resolvedAt", "closedAt",
            "createdAt", "updatedAt", "statusHistory", "attachments",
        )

    def get_assignedDepartment(self, complaint):
        department = complaint.department
        if department is None:
            return None
        return {"id": department.id, "identifier": department.identifier, "name": department.name}


class ComplaintCreateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=200, trim_whitespace=True)
    description = serializers.CharField(max_length=5000, trim_whitespace=True)
    category = serializers.CharField(max_length=120, trim_whitespace=True)

    def create(self, validated_data):
        return create_complaint(actor=self.context["request"].user, **validated_data)


class ComplaintUpdateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=200, required=False, trim_whitespace=True)
    description = serializers.CharField(max_length=5000, required=False, trim_whitespace=True)
    category = serializers.CharField(max_length=120, required=False, trim_whitespace=True)

    def update(self, instance, validated_data):
        return update_complaint(
            complaint=instance,
            actor=self.context["request"].user,
            changes=validated_data,
        )


class StatusChangeSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=Complaint.Status.choices)
    note = serializers.CharField(max_length=1000, required=False, allow_blank=True)


class ResolutionSerializer(serializers.Serializer):
    resolution = serializers.CharField(max_length=2000, trim_whitespace=True)

    def validate_resolution(self, value):
        if not value.strip():
            raise serializers.ValidationError("A non-empty resolution is required.")
        return value.strip()


class ReopenSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=1000, trim_whitespace=True)

    def validate_reason(self, value):
        if not value.strip():
            raise serializers.ValidationError("A reason is required to reopen a complaint.")
        return value.strip()


class PriorityOverrideSerializer(serializers.Serializer):
    priority = serializers.ChoiceField(choices=Complaint.Priority.choices)
    reason = serializers.CharField(max_length=1000, trim_whitespace=True)

    def validate_reason(self, value):
        if not value.strip():
            raise serializers.ValidationError("A reason is required for every priority override.")
        return value.strip()


class DepartmentReassignmentSerializer(serializers.Serializer):
    department_id = serializers.PrimaryKeyRelatedField(
        source="department", queryset=Department.objects.filter(is_active=True)
    )
    reason = serializers.CharField(max_length=1000, trim_whitespace=True)

    def validate_reason(self, value):
        if not value.strip():
            raise serializers.ValidationError("A reason is required for department reassignment.")
        return value.strip()


class ComplaintAttachmentCreateSerializer(serializers.Serializer):
    file = serializers.FileField()

    def validate_file(self, uploaded_file):
        extension = PurePosixPath(uploaded_file.name).suffix.lower().lstrip(".")
        if extension not in ALLOWED_UPLOAD_EXTENSIONS:
            raise serializers.ValidationError("Only JPG, PNG, and PDF attachments are supported.")
        if uploaded_file.size > MAX_UPLOAD_BYTES:
            raise serializers.ValidationError("Attachments may not exceed 10 MB.")
        if uploaded_file.size == 0:
            raise serializers.ValidationError("The uploaded file is empty.")
        return uploaded_file


class CategoryDepartmentMappingSerializer(serializers.ModelSerializer):
    department_id = serializers.PrimaryKeyRelatedField(
        source="department",
        queryset=Department.objects.filter(is_active=True),
        required=False,
        allow_null=True,
    )
    department_name = serializers.CharField(source="department.name", read_only=True, allow_null=True)
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = CategoryDepartmentMapping
        fields = ("id", "category", "department_id", "department_name", "is_active", "createdAt")

    def validate_category(self, value):
        value = " ".join(value.split())
        mappings = CategoryDepartmentMapping.objects.filter(category__iexact=value)
        if self.instance:
            mappings = mappings.exclude(pk=self.instance.pk)
        if mappings.exists():
            raise serializers.ValidationError("A mapping for this category already exists.")
        return value


class PriorityPolicySerializer(serializers.ModelSerializer):
    class Meta:
        model = PriorityPolicy
        fields = (
            "safety_weight", "affected_users_weight", "service_disruption_weight", "urgency_weight",
            "medium_threshold", "high_threshold", "critical_threshold", "low_due_hours",
            "medium_due_hours", "high_due_hours", "critical_due_hours", "safety_keywords",
            "affected_users_keywords", "disruption_keywords", "urgency_keywords", "updated_at",
        )
        read_only_fields = ("updated_at",)

    def validate(self, attrs):
        combined = {
            field: attrs.get(field, getattr(self.instance, field, default))
            for field, default in (
                ("safety_weight", 40),
                ("affected_users_weight", 20),
                ("service_disruption_weight", 20),
                ("urgency_weight", 20),
            )
        }
        if sum(combined.values()) != 100:
            raise serializers.ValidationError("Priority weights must add up to 100.")
        thresholds = [
            attrs.get("medium_threshold", getattr(self.instance, "medium_threshold", 21)),
            attrs.get("high_threshold", getattr(self.instance, "high_threshold", 46)),
            attrs.get("critical_threshold", getattr(self.instance, "critical_threshold", 76)),
        ]
        if not 1 <= thresholds[0] < thresholds[1] < thresholds[2] <= 100:
            raise serializers.ValidationError("Priority thresholds must be increasing values between 1 and 100.")
        for field in ("safety_keywords", "affected_users_keywords", "disruption_keywords", "urgency_keywords"):
            if field in attrs and (not isinstance(attrs[field], list) or not all(isinstance(word, str) for word in attrs[field])):
                raise serializers.ValidationError({field: "Provide a list of keyword strings."})
        return attrs

    def save(self, **kwargs):
        try:
            return super().save(**kwargs)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages) from exc
