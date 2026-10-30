from django.db import models


class UserRole(models.TextChoices):
    SUPER_ADMIN = "SUPER_ADMIN", "Super Admin"
    DEPARTMENT_ADMIN = "DEPARTMENT_ADMIN", "Department Admin"
    EMPLOYEE = "EMPLOYEE", "Employee"
    USER = "USER", "User"
