from django.db import IntegrityError, transaction
from types import SimpleNamespace

from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from accounts.models import DepartmentAdminProfile, EmployeeProfile, User
from accounts.permissions import EmployeeAccessPermission, UserManagementPermission
from accounts.roles import UserRole
from accounts.role_management import ManagedUserSerializer
from accounts.token_utils import issue_token_pair
from departments.models import Department


class UserModelTests(TestCase):
    def test_create_user_normalizes_email_and_hashes_password(self):
        user = User.objects.create_user(
            "  Alex.Example@Example.COM ",
            name="Alex Example",
            password="A-Strong-Test-Passphrase-193!",
        )

        self.assertEqual(user.email, "alex.example@example.com")
        self.assertTrue(user.check_password("A-Strong-Test-Passphrase-193!"))
        self.assertEqual(user.role, UserRole.USER)
        self.assertFalse(user.is_staff)
        self.assertFalse(user.is_superuser)

    def test_email_is_unique_without_case_sensitivity(self):
        User.objects.create_user(
            "alex@example.com",
            name="Alex",
            password="A-Strong-Test-Passphrase-193!",
        )

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                User.objects.create_user(
                    "ALEX@EXAMPLE.COM",
                    name="Duplicate",
                    password="A-Strong-Test-Passphrase-193!",
                )

    def test_superuser_has_super_admin_role_and_staff_access(self):
        user = User.objects.create_superuser(
            "root@example.com",
            name="Root Admin",
            password="A-Strong-Test-Passphrase-193!",
        )

        self.assertEqual(user.role, UserRole.SUPER_ADMIN)
        self.assertTrue(user.is_staff)
        self.assertTrue(user.is_superuser)

    def test_employee_profile_requires_department_and_employee_role(self):
        department, _ = Department.objects.get_or_create(
            identifier="test-electrical",
            defaults={"name": "Test Electrical"},
        )
        employee = User.objects.create_user(
            "employee@example.com",
            name="Employee",
            password="A-Strong-Test-Passphrase-193!",
            role=UserRole.EMPLOYEE,
        )

        profile = EmployeeProfile.objects.create(user=employee, department=department)

        self.assertEqual(profile.department, department)
        self.assertEqual(employee.employee_profile, profile)

    def test_department_admin_profile_binds_admin_to_department(self):
        department, _ = Department.objects.get_or_create(
            identifier="test-plumbing",
            defaults={"name": "Test Plumbing"},
        )
        administrator = User.objects.create_user(
            "dept-admin@example.com",
            name="Department Admin",
            password="A-Strong-Test-Passphrase-193!",
            role=UserRole.DEPARTMENT_ADMIN,
        )

        profile = DepartmentAdminProfile.objects.create(
            user=administrator,
            department=department,
        )

        self.assertEqual(administrator.department_admin_profile.department, department)
        self.assertEqual(profile.user, administrator)


class AuthenticationAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_registration_creates_regular_user_and_returns_legacy_and_jwt_tokens(self):
        response = self.client.post(
            "/api/auth/register",
            {
                "name": "New Resident",
                "email": "  Resident@Example.COM ",
                "password": "A-Strong-Test-Passphrase-193!",
                "role": UserRole.SUPER_ADMIN,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["user"]["email"], "resident@example.com")
        self.assertEqual(response.data["user"]["role"], UserRole.USER)
        self.assertEqual(response.data["token"], response.data["access"])
        self.assertTrue(response.data["refresh"])

    def test_login_is_case_insensitive_and_jwt_authenticates_profile(self):
        User.objects.create_user(
            "resident@example.com",
            name="Resident",
            password="A-Strong-Test-Passphrase-193!",
        )

        login_response = self.client.post(
            "/api/auth/login",
            {"email": "RESIDENT@EXAMPLE.COM", "password": "A-Strong-Test-Passphrase-193!"},
            format="json",
        )

        self.assertEqual(login_response.status_code, 200, login_response.data)
        self.assertEqual(login_response.data["user"]["role"], UserRole.USER)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login_response.data['access']}")
        profile_response = self.client.get("/api/auth/me")

        self.assertEqual(profile_response.status_code, 200)
        self.assertEqual(profile_response.data["email"], "resident@example.com")

    def test_logout_revokes_access_and_refresh_tokens(self):
        user = User.objects.create_user(
            "logout@example.com",
            name="Logout User",
            password="A-Strong-Test-Passphrase-193!",
        )
        tokens = issue_token_pair(user)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

        logout_response = self.client.post("/api/auth/logout", {}, format="json")

        self.assertEqual(logout_response.status_code, 200)
        self.assertEqual(self.client.get("/api/auth/me").status_code, 401)
        refresh_response = self.client.post(
            "/api/auth/token/refresh",
            {"refresh": tokens["refresh"]},
            format="json",
        )
        self.assertEqual(refresh_response.status_code, 401)

    def test_profile_can_be_updated_without_changing_role(self):
        user = User.objects.create_user(
            "profile@example.com",
            name="Before",
            password="A-Strong-Test-Passphrase-193!",
        )
        self.client.force_authenticate(user=user)

        response = self.client.patch(
            "/api/auth/me",
            {"name": "After", "role": UserRole.SUPER_ADMIN},
            format="json",
        )

        user.refresh_from_db()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(user.name, "After")
        self.assertEqual(user.role, UserRole.USER)

    def test_profile_requires_authentication(self):
        self.assertEqual(self.client.get("/api/auth/me").status_code, 401)

    def test_password_change_checks_current_password_and_revokes_access(self):
        user = User.objects.create_user(
            "password-change@example.com",
            name="Password Change User",
            password="A-Strong-Test-Passphrase-193!",
        )
        tokens = issue_token_pair(user)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")

        response = self.client.post(
            "/api/auth/password",
            {
                "old_password": "A-Strong-Test-Passphrase-193!",
                "new_password": "New-Independent-Phrase#3847",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.client.get("/api/auth/me").status_code, 401)
        user.refresh_from_db()
        self.assertTrue(user.check_password("New-Independent-Phrase#3847"))


class EmployeeStatusAPITests(TestCase):
    def test_department_admin_can_activate_or_deactivate_only_own_employee(self):
        department = Department.objects.get(identifier="electrical")
        other_department = Department.objects.get(identifier="plumbing")
        manager = User.objects.create_user(
            "employee-status-admin@example.com", name="Department Admin",
            password="Independent-Test-Passphrase#7291", role=UserRole.DEPARTMENT_ADMIN,
        )
        DepartmentAdminProfile.objects.create(user=manager, department=department)
        employee = User.objects.create_user(
            "employee-status@example.com", name="Technician",
            password="Independent-Test-Passphrase#7291", role=UserRole.EMPLOYEE,
        )
        profile = EmployeeProfile.objects.create(user=employee, department=department)
        client = APIClient()
        client.force_authenticate(manager)
        response = client.patch(f"/api/employees/{profile.pk}/status/", {"is_active": False}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        employee.refresh_from_db()
        self.assertFalse(employee.is_active)
        self.assertFalse(response.data["is_active"])
        self.assertEqual(client.patch(f"/api/employees/{profile.pk}/status/", {"is_active": True}, format="json").status_code, 200)

        outsider = User.objects.create_user(
            "other-status-admin@example.com", name="Other Department Admin",
            password="Independent-Test-Passphrase#7291", role=UserRole.DEPARTMENT_ADMIN,
        )
        DepartmentAdminProfile.objects.create(user=outsider, department=other_department)
        client.force_authenticate(outsider)
        self.assertEqual(client.patch(f"/api/employees/{profile.pk}/status/", {"is_active": False}, format="json").status_code, 404)


class RoleManagementSerializerTests(TestCase):
    def setUp(self):
        self.department, _ = Department.objects.get_or_create(
            identifier="role-management-test",
            defaults={"name": "Role Management Test"},
        )

    def test_role_assignment_creates_department_profile(self):
        serializer = ManagedUserSerializer(
            data={
                "name": "Employee One",
                "email": "employee-one@example.com",
                "password": "A-Strong-Test-Passphrase-193!",
                "role": UserRole.EMPLOYEE,
                "department_id": self.department.pk,
            }
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        user = serializer.save()

        self.assertEqual(user.role, UserRole.EMPLOYEE)
        self.assertEqual(user.employee_profile.department, self.department)

    def test_department_role_cannot_be_assigned_without_department(self):
        serializer = ManagedUserSerializer(
            data={
                "name": "Missing Department",
                "email": "missing-dept@example.com",
                "password": "A-Strong-Test-Passphrase-193!",
                "role": UserRole.DEPARTMENT_ADMIN,
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("department_id", serializer.errors)

    def test_last_active_super_admin_cannot_be_deactivated(self):
        administrator = User.objects.create_superuser(
            "only-root@example.com",
            name="Only Root",
            password="A-Strong-Test-Passphrase-193!",
        )
        serializer = ManagedUserSerializer(
            administrator,
            data={"is_active": False},
            partial=True,
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("non_field_errors", serializer.errors)


class RolePermissionUnitTests(SimpleTestCase):
    def setUp(self):
        self.department_one = SimpleNamespace(pk=1)
        self.department_two = SimpleNamespace(pk=2)
        self.department_admin = SimpleNamespace(
            pk=10,
            is_authenticated=True,
            role=UserRole.DEPARTMENT_ADMIN,
            department_admin_profile=SimpleNamespace(department=self.department_one),
        )
        self.employee = SimpleNamespace(
            pk=20,
            is_authenticated=True,
            role=UserRole.EMPLOYEE,
            employee_profile=SimpleNamespace(department=self.department_one),
        )

    def test_department_admin_user_access_is_limited_to_department(self):
        permission = UserManagementPermission()
        request = SimpleNamespace(user=self.department_admin, method="GET")
        same_department_user = SimpleNamespace(
            is_authenticated=True,
            role=UserRole.EMPLOYEE,
            employee_profile=SimpleNamespace(department=self.department_one),
        )
        other_department_user = SimpleNamespace(
            is_authenticated=True,
            role=UserRole.EMPLOYEE,
            employee_profile=SimpleNamespace(department=self.department_two),
        )

        self.assertTrue(permission.has_permission(request, SimpleNamespace()))
        self.assertTrue(permission.has_object_permission(request, SimpleNamespace(), same_department_user))
        self.assertFalse(permission.has_object_permission(request, SimpleNamespace(), other_department_user))

    def test_employee_can_only_open_their_own_profile_action(self):
        permission = EmployeeAccessPermission()
        me_view = SimpleNamespace(action="me")
        list_view = SimpleNamespace(action="list")
        request = SimpleNamespace(user=self.employee, method="GET")

        self.assertTrue(permission.has_permission(request, me_view))
        self.assertFalse(permission.has_permission(request, list_view))
        self.assertTrue(
            permission.has_object_permission(
                request,
                me_view,
                SimpleNamespace(user_id=self.employee.pk, department_id=1),
            )
        )
        self.assertFalse(
            permission.has_object_permission(
                request,
                me_view,
                SimpleNamespace(user_id=21, department_id=1),
            )
        )


class ManagementPermissionAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.electrical, _ = Department.objects.get_or_create(
            identifier="api-test-electrical",
            defaults={"name": "API Test Electrical"},
        )
        self.plumbing, _ = Department.objects.get_or_create(
            identifier="api-test-plumbing",
            defaults={"name": "API Test Plumbing"},
        )
        self.super_admin = User.objects.create_superuser(
            "super-admin@example.com",
            name="Super Admin",
            password="A-Strong-Test-Passphrase-193!",
        )
        self.department_admin = User.objects.create_user(
            "electrical-admin@example.com",
            name="Electrical Admin",
            password="A-Strong-Test-Passphrase-193!",
            role=UserRole.DEPARTMENT_ADMIN,
        )
        DepartmentAdminProfile.objects.create(
            user=self.department_admin,
            department=self.electrical,
        )
        self.employee = User.objects.create_user(
            "electrical-employee@example.com",
            name="Electrical Employee",
            password="A-Strong-Test-Passphrase-193!",
            role=UserRole.EMPLOYEE,
        )
        self.employee_profile = EmployeeProfile.objects.create(
            user=self.employee,
            department=self.electrical,
            job_title="Technician",
        )
        self.other_employee = User.objects.create_user(
            "plumbing-employee@example.com",
            name="Plumbing Employee",
            password="A-Strong-Test-Passphrase-193!",
            role=UserRole.EMPLOYEE,
        )
        self.other_employee_profile = EmployeeProfile.objects.create(
            user=self.other_employee,
            department=self.plumbing,
        )
        self.regular_user = User.objects.create_user(
            "resident-api@example.com",
            name="Resident",
            password="A-Strong-Test-Passphrase-193!",
        )

    def test_unauthenticated_management_requests_are_rejected(self):
        for path in ("/api/departments/", "/api/users/", "/api/employees/"):
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 401)

    def test_super_admin_has_organization_wide_access_and_can_assign_roles(self):
        self.client.force_authenticate(user=self.super_admin)

        department_response = self.client.get("/api/departments/")
        user_response = self.client.get("/api/users/")
        employee_response = self.client.get("/api/employees/")
        self.assertEqual(department_response.status_code, 200)
        self.assertGreaterEqual(len(department_response.data), 5)
        self.assertEqual(user_response.status_code, 200)
        self.assertEqual(employee_response.status_code, 200)
        self.assertEqual(len(employee_response.data), 2)

        create_response = self.client.post(
            "/api/users/",
            {
                "name": "New Department Admin",
                "email": "new-dept-admin@example.com",
                "password": "A-Strong-Test-Passphrase-193!",
                "role": UserRole.DEPARTMENT_ADMIN,
                "department_id": self.plumbing.pk,
            },
            format="json",
        )
        self.assertEqual(create_response.status_code, 201, create_response.data)
        created = User.objects.get(email="new-dept-admin@example.com")
        self.assertEqual(created.department_admin_profile.department, self.plumbing)
        self.assertEqual(create_response.data["role"], UserRole.DEPARTMENT_ADMIN)

        deactivate_response = self.client.delete(f"/api/users/{created.pk}/")
        created.refresh_from_db()
        self.assertEqual(deactivate_response.status_code, 204)
        self.assertFalse(created.is_active)
        self.assertTrue(User.objects.filter(pk=created.pk).exists())

        department_create = self.client.post(
            "/api/departments/",
            {
                "name": "Security",
                "description": "Physical security services.",
                "identifier": "security",
                "is_active": True,
            },
            format="json",
        )
        self.assertEqual(department_create.status_code, 201, department_create.data)
        self.assertTrue(Department.objects.filter(identifier="security", is_active=True).exists())

    def test_department_admin_is_scoped_and_can_create_employees_in_own_department(self):
        self.client.force_authenticate(user=self.department_admin)

        departments = self.client.get("/api/departments/")
        employees = self.client.get("/api/employees/")
        users = self.client.get("/api/users/")
        self.assertEqual([row["id"] for row in departments.data], [self.electrical.pk])
        self.assertEqual([row["id"] for row in employees.data], [self.employee_profile.pk])
        self.assertEqual(
            {row["id"] for row in users.data},
            {self.department_admin.pk, self.employee.pk},
        )
        self.assertEqual(
            self.client.get(f"/api/employees/{self.other_employee_profile.pk}/").status_code,
            404,
        )
        self.assertEqual(
            self.client.get(f"/api/departments/{self.plumbing.pk}/").status_code,
            404,
        )
        self.assertEqual(
            self.client.post(
                "/api/departments/",
                {"name": "Unauthorized", "identifier": "unauthorized"},
                format="json",
            ).status_code,
            403,
        )

        create_response = self.client.post(
            "/api/employees/",
            {
                "name": "New Electrical Employee",
                "email": "new-electrical@example.com",
                "password": "A-Strong-Test-Passphrase-193!",
                "job_title": "Field Technician",
            },
            format="json",
        )
        self.assertEqual(create_response.status_code, 201, create_response.data)
        created_profile = EmployeeProfile.objects.get(user__email="new-electrical@example.com")
        self.assertEqual(created_profile.department, self.electrical)

        cross_department_create = self.client.post(
            "/api/employees/",
            {
                "name": "Wrong Department",
                "email": "wrong-department@example.com",
                "password": "A-Strong-Test-Passphrase-193!",
                "department_id": self.plumbing.pk,
            },
            format="json",
        )
        self.assertEqual(cross_department_create.status_code, 400)

    def test_employee_can_read_only_their_own_profile(self):
        self.client.force_authenticate(user=self.employee)

        self_response = self.client.get("/api/employees/me/")
        self.assertEqual(self_response.status_code, 200)
        self.assertEqual(self_response.data["user_id"], self.employee.pk)
        self.assertEqual(self.client.get("/api/employees/").status_code, 403)
        self.assertEqual(self.client.get("/api/users/").status_code, 403)
        self.assertEqual(self.client.get("/api/auth/me").status_code, 200)

    def test_regular_user_can_only_access_own_profile_and_public_department_list(self):
        self.client.force_authenticate(user=self.regular_user)

        self.assertEqual(self.client.get("/api/auth/me").status_code, 200)
        self.assertEqual(self.client.get("/api/departments/").status_code, 200)
        self.assertEqual(self.client.get("/api/users/").status_code, 403)
        self.assertEqual(self.client.get("/api/employees/").status_code, 403)

    def test_admin_login_route_rejects_regular_users(self):
        response = self.client.post(
            "/api/admin/login",
            {"email": "resident-api@example.com", "password": "A-Strong-Test-Passphrase-193!"},
            format="json",
        )

        self.assertEqual(response.status_code, 401)

    def test_department_admin_jwt_keeps_department_scope(self):
        login = self.client.post(
            "/api/auth/login",
            {
                "email": "ELECTRICAL-ADMIN@example.com",
                "password": "A-Strong-Test-Passphrase-193!",
            },
            format="json",
        )
        self.assertEqual(login.status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")

        self.assertEqual(len(self.client.get("/api/employees/").data), 1)
        self.assertEqual(
            self.client.get(f"/api/employees/{self.other_employee_profile.pk}/").status_code,
            404,
        )
        self.assertEqual(
            self.client.get(f"/api/users/{self.other_employee.pk}/").status_code,
            404,
        )
        self.assertEqual(
            self.client.post(
                "/api/users/",
                {
                    "name": "Privilege Escalation",
                    "email": "elevated@example.com",
                    "password": "A-Strong-Test-Passphrase-193!",
                    "role": UserRole.SUPER_ADMIN,
                },
                format="json",
            ).status_code,
            403,
        )
