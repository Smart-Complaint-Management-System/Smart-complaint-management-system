from django.db.models import Q
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from accounts.employee_serializers import (
    EmployeeCreateSerializer,
    EmployeeProfileSerializer,
    EmployeeProfileUpdateSerializer,
)
from accounts.models import EmployeeProfile, User
from accounts.permissions import EmployeeAccessPermission, UserManagementPermission
from accounts.role_management import ManagedUserSerializer
from accounts.roles import UserRole, department_for_user, has_role
from accounts.serializers import UserSummarySerializer
from accounts.token_utils import revoke_user_tokens
from audit.services import log_event


class UserViewSet(viewsets.ModelViewSet):
    permission_classes = [UserManagementPermission]

    def get_queryset(self):
        user = self.request.user
        if has_role(user, UserRole.SUPER_ADMIN):
            return User.objects.all()
        if has_role(user, UserRole.DEPARTMENT_ADMIN):
            department = department_for_user(user)
            if department is None or not department.is_active:
                return User.objects.none()
            return User.objects.filter(
                Q(role=UserRole.EMPLOYEE, employee_profile__department=department)
                | Q(role=UserRole.DEPARTMENT_ADMIN, department_admin_profile__department=department)
            ).distinct()
        return User.objects.none()

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return ManagedUserSerializer
        return UserSummarySerializer

    def perform_destroy(self, instance):
        serializer = ManagedUserSerializer(instance, data={"is_active": False}, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        log_event(actor=self.request.user, action="USER_DEACTIVATED", department=department_for_user(instance),
                  previous_value={"is_active": True}, new_value={"is_active": False},
                  metadata={"user_id": instance.pk, "email": instance.email, "role": instance.role})

    def perform_create(self, serializer):
        user = serializer.save()
        log_event(actor=self.request.user, action="USER_CREATED", department=department_for_user(user),
                  new_value={"user_id": user.pk, "email": user.email, "role": user.role})

    def perform_update(self, serializer):
        previous = {"role": serializer.instance.role, "is_active": serializer.instance.is_active}
        user = serializer.save()
        log_event(actor=self.request.user, action="USER_UPDATED", department=department_for_user(user),
                  previous_value=previous, new_value={"role": user.role, "is_active": user.is_active},
                  metadata={"user_id": user.pk, "email": user.email})

    def destroy(self, request, *args, **kwargs):
        self.perform_destroy(self.get_object())
        return Response(status=status.HTTP_204_NO_CONTENT)


class EmployeeViewSet(viewsets.ModelViewSet):
    permission_classes = [EmployeeAccessPermission]

    def get_queryset(self):
        user = self.request.user
        queryset = EmployeeProfile.objects.select_related("user", "department")
        if has_role(user, UserRole.SUPER_ADMIN):
            return queryset
        if has_role(user, UserRole.DEPARTMENT_ADMIN):
            department = department_for_user(user)
            return (
                queryset.filter(department=department)
                if department and department.is_active
                else queryset.none()
            )
        if has_role(user, UserRole.EMPLOYEE):
            return queryset.filter(user=user)
        return queryset.none()

    def get_serializer_class(self):
        if self.action == "create":
            return EmployeeCreateSerializer
        if self.action in ("update", "partial_update"):
            return EmployeeProfileUpdateSerializer
        return EmployeeProfileSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        employee = serializer.save()
        log_event(actor=request.user, action="EMPLOYEE_CREATED", department=employee.department,
                  new_value={"employee_id": employee.user_id, "department_id": employee.department_id})
        return Response(EmployeeProfileSerializer(employee).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop("partial", False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        employee = serializer.save()
        log_event(actor=request.user, action="EMPLOYEE_UPDATED", department=employee.department,
                  new_value={"employee_id": employee.user_id, "department_id": employee.department_id,
                             "job_title": employee.job_title})
        return Response(EmployeeProfileSerializer(employee).data)

    @action(detail=False, methods=["get"], url_path="me")
    def me(self, request):
        employee = self.get_queryset().filter(user=request.user).first()
        if employee is None:
            raise ValidationError("An employee profile is not associated with this account.")
        self.check_object_permissions(request, employee)
        return Response(EmployeeProfileSerializer(employee).data)

    def perform_destroy(self, instance):
        instance.user.is_active = False
        instance.user.save(update_fields=["is_active"])
        revoke_user_tokens(instance.user)
        log_event(actor=self.request.user, action="EMPLOYEE_DEACTIVATED", department=instance.department,
                  previous_value={"is_active": True}, new_value={"is_active": False},
                  metadata={"employee_id": instance.user_id})

    def destroy(self, request, *args, **kwargs):
        self.perform_destroy(self.get_object())
        return Response(status=status.HTTP_204_NO_CONTENT)
