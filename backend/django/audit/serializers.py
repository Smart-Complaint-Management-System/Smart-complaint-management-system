from rest_framework import serializers

from accounts.serializers import UserSummarySerializer
from audit.models import AuditEvent


class AuditEventSerializer(serializers.ModelSerializer):
    actor = UserSummarySerializer(read_only=True)
    complaint_id = serializers.CharField(source="complaint.complaint_id", read_only=True, allow_null=True)
    department_name = serializers.CharField(source="department.name", read_only=True, allow_null=True)

    class Meta:
        model = AuditEvent
        fields = (
            "id", "actor", "actor_role", "action", "complaint_id", "department_id", "department_name",
            "previous_value", "new_value", "metadata", "created_at",
        )
