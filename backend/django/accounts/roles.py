from django.db import models
from django.core.exceptions import ObjectDoesNotExist


class UserRole(models.TextChoices):
    SUPER_ADMIN = "SUPER_ADMIN", "Super Admin"
    DEPARTMENT_ADMIN = "DEPARTMENT_ADMIN", "Department Admin"
    EMPLOYEE = "EMPLOYEE", "Employee"
    USER = "USER", "User"


def department_for_user(user):
    if not getattr(user, "is_authenticated", False):
        return None
    try:
        if user.role == UserRole.DEPARTMENT_ADMIN:
            return user.department_admin_profile.department
        if user.role == UserRole.EMPLOYEE:
            return user.employee_profile.department
    except ObjectDoesNotExist:
        return None
    return None


def has_role(user, *roles):
    return bool(getattr(user, "is_authenticated", False) and user.role in roles)
