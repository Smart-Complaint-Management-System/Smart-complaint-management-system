from django.contrib.auth import get_user_model
from rest_framework import serializers

from accounts.serializers import UserSummarySerializer
from assignments.models import WorkAssignment, WorkEvidence, WorkUpdate
from complaints.models import Complaint

User = get_user_model()


class WorkUpdateSerializer(serializers.ModelSerializer):
    actor = UserSummarySerializer(read_only=True)
    createdAt = serializers.DateTimeField(source="created_at", read_only=True)

    class Meta:
        model = WorkUpdate
        fields = ("id", "actor", "progress_percent", "note", "createdAt")


class WorkEvidenceSerializer(serializers.ModelSerializer):
    uploadedBy = UserSummarySerializer(source="uploaded_by", read_only=True)
    url = serializers.SerializerMethodField()

    class Meta:
        model = WorkEvidence
        fields = ("id", "url", "original_name", "content_type", "size_bytes", "uploadedBy", "created_at")

    def get_url(self, evidence):
        request = self.context.get("request")
        path = evidence.file.url
        return request.build_absolute_uri(path) if request else path


class AssignmentReadSerializer(serializers.ModelSerializer):
    complaint_id = serializers.CharField(source="complaint.complaint_id", read_only=True)
    complaint_title = serializers.CharField(source="complaint.title", read_only=True)
    complaint_status = serializers.CharField(source="complaint.status", read_only=True)
    priority = serializers.CharField(source="complaint.priority", read_only=True)
    priority_score = serializers.IntegerField(source="complaint.priority_score", read_only=True)
    department_id = serializers.IntegerField(source="complaint.department_id", read_only=True)
    department_name = serializers.CharField(source="complaint.department.name", read_only=True, allow_null=True)
    employee = UserSummarySerializer(read_only=True)
    assigned_by = UserSummarySerializer(read_only=True)
    updates = WorkUpdateSerializer(many=True, read_only=True)
    evidence = WorkEvidenceSerializer(many=True, read_only=True)

    class Meta:
        model = WorkAssignment
        fields = (
            "id", "complaint", "complaint_id", "complaint_title", "complaint_status", "priority",
            "priority_score", "department_id", "department_name", "employee", "assigned_by",
            "reassigned_from_id", "status", "is_current", "due_at", "assigned_at", "accepted_at",
            "started_at", "completed_at", "verified_at", "updates", "evidence",
        )


class AssignmentCreateSerializer(serializers.Serializer):
    complaint_id = serializers.CharField(max_length=64)
    employee_id = serializers.PrimaryKeyRelatedField(
        source="employee",
        queryset=User.objects.filter(role="EMPLOYEE", is_active=True),
    )
    due_at = serializers.DateTimeField(required=False, allow_null=True)
    reason = serializers.CharField(max_length=1000, required=False, allow_blank=True)

    def validate_complaint_id(self, value):
        from complaints.views import visible_complaints_for

        complaint = visible_complaints_for(self.context["request"].user).filter(complaint_id=value).first()
        if complaint is None:
            raise serializers.ValidationError("Complaint not found in your organization scope.")
        self._complaint = complaint
        return value

    def create(self, validated_data):
        from assignments.services import assign_complaint

        return assign_complaint(
            complaint=self._complaint,
            actor=self.context["request"].user,
            employee=validated_data["employee"],
            due_at=validated_data.get("due_at"),
            override_reason=validated_data.get("reason", ""),
        )


class ReassignSerializer(serializers.Serializer):
    employee_id = serializers.PrimaryKeyRelatedField(
        source="employee",
        queryset=User.objects.filter(role="EMPLOYEE", is_active=True),
    )
    due_at = serializers.DateTimeField(required=False, allow_null=True)
    reason = serializers.CharField(max_length=1000, required=False, allow_blank=True)


class ProgressSerializer(serializers.Serializer):
    note = serializers.CharField(max_length=2000, required=False, allow_blank=True)
    progress_percent = serializers.IntegerField(min_value=0, max_value=100, required=False)


class CompleteWorkSerializer(serializers.Serializer):
    note = serializers.CharField(max_length=2000, required=False, allow_blank=True)


class VerifyWorkSerializer(serializers.Serializer):
    resolution = serializers.CharField(max_length=2000, trim_whitespace=True)

    def validate_resolution(self, value):
        if not value.strip():
            raise serializers.ValidationError("A resolution is required.")
        return value.strip()
