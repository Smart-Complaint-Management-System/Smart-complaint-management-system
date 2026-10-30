from rest_framework import viewsets

from accounts.permissions import DepartmentAccessPermission
from accounts.roles import UserRole, department_for_user, has_role
from departments.models import Department
from departments.serializers import DepartmentSerializer


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
