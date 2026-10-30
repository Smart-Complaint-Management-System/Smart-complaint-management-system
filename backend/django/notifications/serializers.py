from rest_framework import serializers

from accounts.serializers import UserSummarySerializer
from notifications.models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    actor = UserSummarySerializer(read_only=True)
    complaint_id = serializers.CharField(source="complaint.complaint_id", read_only=True, allow_null=True)

    class Meta:
        model = Notification
        fields = ("id", "actor", "complaint_id", "kind", "title", "message", "read_at", "created_at")
