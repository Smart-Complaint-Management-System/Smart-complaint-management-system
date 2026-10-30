from rest_framework.permissions import SAFE_METHODS, BasePermission

from accounts.roles import UserRole, department_for_user, has_role


class IsSuperAdmin(BasePermission):
    def has_permission(self, request, view):
        return has_role(request.user, UserRole.SUPER_ADMIN)


class UserManagementPermission(BasePermission):
    """Super admins manage all accounts; department admins read their members."""

    def has_permission(self, request, view):
        if has_role(request.user, UserRole.SUPER_ADMIN):
            return True
        return request.method in SAFE_METHODS and has_role(
            request.user,
            UserRole.DEPARTMENT_ADMIN,
        )

    def has_object_permission(self, request, view, obj):
        if has_role(request.user, UserRole.SUPER_ADMIN):
            return True
        if not has_role(request.user, UserRole.DEPARTMENT_ADMIN):
            return False
        department = department_for_user(request.user)
        return department is not None and department_for_user(obj) == department


class DepartmentAccessPermission(BasePermission):
    """Department admins and employees can access only their own department."""

    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        if request.method in SAFE_METHODS:
            return True
        return has_role(request.user, UserRole.SUPER_ADMIN)

    def has_object_permission(self, request, view, obj):
        if has_role(request.user, UserRole.SUPER_ADMIN):
            return True
        if has_role(request.user, UserRole.DEPARTMENT_ADMIN, UserRole.EMPLOYEE):
            department = department_for_user(request.user)
            return department is not None and department.pk == obj.pk
        return request.method in SAFE_METHODS and obj.is_active


class EmployeeAccessPermission(BasePermission):
    """Employees may read their own profile; admins are scoped by department."""

    def has_permission(self, request, view):
        if has_role(request.user, UserRole.SUPER_ADMIN, UserRole.DEPARTMENT_ADMIN):
            return True
        return (
            request.method in SAFE_METHODS
            and getattr(view, "action", None) == "me"
            and has_role(request.user, UserRole.EMPLOYEE)
        )

    def has_object_permission(self, request, view, obj):
        if has_role(request.user, UserRole.SUPER_ADMIN):
            return True
        if has_role(request.user, UserRole.DEPARTMENT_ADMIN):
            department = department_for_user(request.user)
            return department is not None and obj.department_id == department.pk
        if has_role(request.user, UserRole.EMPLOYEE):
            return request.method in SAFE_METHODS and obj.user_id == request.user.pk
        return False
