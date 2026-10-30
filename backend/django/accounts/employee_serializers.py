from django.contrib.auth import get_user_model, password_validation
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import serializers

from accounts.models import EmployeeProfile
from accounts.roles import UserRole, department_for_user, has_role
from departments.models import Department

User = get_user_model()


class EmployeeProfileSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source="user.name", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    department_id = serializers.IntegerField(source="department.id", read_only=True)
    department_name = serializers.CharField(source="department.name", read_only=True)
    is_active = serializers.BooleanField(source="user.is_active", read_only=True)

    class Meta:
        model = EmployeeProfile
        fields = ("id", "user_id", "name", "email", "department_id", "department_name", "job_title", "is_active", "created_at")
        read_only_fields = fields


class EmployeeCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=150, trim_whitespace=True)
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(write_only=True, trim_whitespace=False)
    job_title = serializers.CharField(max_length=120, required=False, allow_blank=True)
    department_id = serializers.PrimaryKeyRelatedField(
        queryset=Department.objects.filter(is_active=True),
        source="department",
        required=False,
    )

    def validate_email(self, value):
        value = value.strip().lower()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value

    def validate(self, attrs):
        try:
            password_validation.validate_password(
                attrs["password"],
                User(name=attrs["name"], email=attrs["email"]),
            )
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": list(exc.messages)}) from exc
        department = attrs.get("department")
        request_user = self.context["request"].user
        if has_role(request_user, UserRole.DEPARTMENT_ADMIN):
            allowed_department = department_for_user(request_user)
            if allowed_department is None:
                raise serializers.ValidationError("Your account is not associated with a department.")
            if department is not None and department.pk != allowed_department.pk:
                raise serializers.ValidationError(
                    {"department_id": "You can create employees only in your department."}
                )
            department = allowed_department
        if department is None:
            raise serializers.ValidationError({"department_id": "A department is required."})
        attrs["department"] = department
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        department = validated_data.pop("department")
        job_title = validated_data.pop("job_title", "")
        password = validated_data.pop("password")
        user = User.objects.create_user(
            **validated_data,
            password=password,
            role=UserRole.EMPLOYEE,
        )
        return EmployeeProfile.objects.create(
            user=user,
            department=department,
            job_title=job_title,
        )


class EmployeeProfileUpdateSerializer(serializers.ModelSerializer):
    department_id = serializers.PrimaryKeyRelatedField(
        queryset=Department.objects.filter(is_active=True),
        source="department",
        required=False,
    )

    class Meta:
        model = EmployeeProfile
        fields = ("job_title", "department_id")

    def validate_department_id(self, department):
        request_user = self.context["request"].user
        if has_role(request_user, UserRole.DEPARTMENT_ADMIN):
            allowed_department = department_for_user(request_user)
            if department.pk != allowed_department.pk:
                raise serializers.ValidationError("You cannot move an employee outside your department.")
        return department
