from rest_framework import serializers

from departments.models import Department


class DepartmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = ("id", "name", "description", "identifier", "is_active", "created_at")
        read_only_fields = ("id", "created_at")
