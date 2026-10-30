from rest_framework import viewsets

from accounts.permissions import DepartmentAccessPermission
from accounts.roles import UserRole, department_for_user, has_role
from departments.models import Department
from departments.serializers import DepartmentSerializer
from audit.services import log_event


class DepartmentViewSet(viewsets.ModelViewSet):
    serializer_class = DepartmentSerializer
    permission_classes = [DepartmentAccessPermission]

    def get_queryset(self):
        user = self.request.user
        if has_role(user, UserRole.SUPER_ADMIN):
            return Department.objects.all()
        if has_role(user, UserRole.DEPARTMENT_ADMIN, UserRole.EMPLOYEE):
            department = department_for_user(user)
            return (
                Department.objects.filter(pk=department.pk, is_active=True)
                if department
                else Department.objects.none()
            )
        return Department.objects.filter(is_active=True)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=["is_active"])
        log_event(actor=self.request.user, action="DEPARTMENT_DEACTIVATED", department=instance,
                  previous_value={"is_active": True}, new_value={"is_active": False})

    def perform_create(self, serializer):
        department = serializer.save()
        log_event(actor=self.request.user, action="DEPARTMENT_CREATED", department=department,
                  new_value={"name": department.name, "identifier": department.identifier,
                             "is_active": department.is_active})

    def perform_update(self, serializer):
        previous = {"name": serializer.instance.name, "description": serializer.instance.description,
                    "is_active": serializer.instance.is_active}
        department = serializer.save()
        log_event(actor=self.request.user, action="DEPARTMENT_UPDATED", department=department,
                  previous_value=previous,
                  new_value={"name": department.name, "description": department.description,
                             "is_active": department.is_active})
