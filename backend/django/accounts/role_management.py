from django.contrib.auth import get_user_model, password_validation
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from rest_framework import serializers

from accounts.models import DepartmentAdminProfile, EmployeeProfile
from accounts.roles import UserRole
from accounts.serializers import UserSummarySerializer, get_department_for_user
from accounts.token_utils import revoke_user_tokens
from departments.models import Department

User = get_user_model()


class ManagedUserSerializer(UserSummarySerializer):
    password = serializers.CharField(write_only=True, required=False, trim_whitespace=False)
    role = serializers.ChoiceField(choices=UserRole.choices)
    is_active = serializers.BooleanField(required=False)
    department_id = serializers.PrimaryKeyRelatedField(
        queryset=Department.objects.filter(is_active=True),
        source="department",
        write_only=True,
        required=False,
        allow_null=True,
    )
    department = serializers.SerializerMethodField()

    class Meta(UserSummarySerializer.Meta):
        fields = UserSummarySerializer.Meta.fields + ("password", "department_id", "date_joined")
        read_only_fields = ("id", "date_joined")

    def get_fields(self):
        fields = super().get_fields()
        fields["password"].required = self.instance is None
        return fields

    def validate_email(self, value):
        value = value.strip().lower()
        users = User.objects.filter(email__iexact=value)
        if self.instance:
            users = users.exclude(pk=self.instance.pk)
        if users.exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value

    def validate_password(self, value):
        try:
            password_validation.validate_password(value, self.instance)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(list(exc.messages)) from exc
        return value

    def validate(self, attrs):
        role = attrs.get("role", self.instance.role if self.instance else UserRole.USER)
        department = attrs.get("department")
        if department is None and self.instance and role == self.instance.role:
            department = get_department_for_user(self.instance)

        department_roles = (UserRole.DEPARTMENT_ADMIN, UserRole.EMPLOYEE)
        if role in department_roles and department is None:
            raise serializers.ValidationError(
                {"department_id": "A department is required for department admins and employees."}
            )
        if role not in department_roles and department is not None:
            raise serializers.ValidationError(
                {"department_id": "Only department admins and employees can be assigned a department."}
            )

        if self.instance and self.instance.role == UserRole.SUPER_ADMIN and self.instance.is_active:
            next_active = attrs.get("is_active", self.instance.is_active)
            if role != UserRole.SUPER_ADMIN or not next_active:
                another_active_super_admin = User.objects.filter(
                    role=UserRole.SUPER_ADMIN,
                    is_active=True,
                ).exclude(pk=self.instance.pk)
                if not another_active_super_admin.exists():
                    raise serializers.ValidationError(
                        "The last active super admin cannot be demoted or deactivated."
                    )

        if role in department_roles:
            attrs["department"] = department
        else:
            attrs.pop("department", None)
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        password = validated_data.pop("password")
        department = validated_data.pop("department", None)
        role = validated_data["role"]
        user = User.objects.create_user(password=password, **validated_data)
        self._assign_department_profile(user, role, department)
        return user

    @transaction.atomic
    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        department = validated_data.pop("department", None)
        role = validated_data.get("role", instance.role)
        access_changed = (
            role != instance.role
            or validated_data.get("is_active", instance.is_active) != instance.is_active
        )

        for attribute, value in validated_data.items():
            setattr(instance, attribute, value)
        if password:
            instance.set_password(password)
        instance.save()
        self._assign_department_profile(instance, role, department)
        if access_changed:
            revoke_user_tokens(instance)
        return instance

    @staticmethod
    def _assign_department_profile(user, role, department):
        if role == UserRole.DEPARTMENT_ADMIN:
            DepartmentAdminProfile.objects.update_or_create(
                user=user,
                defaults={"department": department},
            )
        elif role == UserRole.EMPLOYEE:
            EmployeeProfile.objects.update_or_create(
                user=user,
                defaults={"department": department},
            )

