from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import DepartmentAdminProfile, User
from accounts.roles import UserRole
from complaints.services import create_complaint
from departments.models import Department


PASSWORD = "Independent-Test-Passphrase#7291"


class DashboardScopeTests(TestCase):
    def setUp(self):
        self.electrical = Department.objects.get(identifier="electrical")
        self.plumbing = Department.objects.get(identifier="plumbing")
        self.admin = User.objects.create_user(
            "dashboard-admin@example.com", name="Electrical Admin", password=PASSWORD,
            role=UserRole.DEPARTMENT_ADMIN,
        )
        DepartmentAdminProfile.objects.create(user=self.admin, department=self.electrical)
        self.super_admin = User.objects.create_superuser(
            "dashboard-super@example.com", name="Super Admin", password=PASSWORD,
        )
        self.owner = User.objects.create_user("dashboard-owner@example.com", name="Owner", password=PASSWORD)
        self.electrical_complaint = create_complaint(
            actor=self.owner, title="Socket repair", description="A socket needs repair", category="Electrical",
        )
        create_complaint(
            actor=self.owner, title="Leaking tap", description="Water leaking in a washroom", category="Plumbing",
        )

    def test_department_and_super_admin_dashboards_return_scoped_live_counts(self):
        client = APIClient()
        client.force_authenticate(self.admin)
        scoped = client.get("/api/dashboard/summary").data
        self.assertEqual(scoped["stats"]["total"], 1)
        self.assertEqual(scoped["department"]["name"], self.electrical.name)
        client.force_authenticate(self.super_admin)
        organization = client.get("/api/dashboard/summary").data
        self.assertEqual(organization["stats"]["total"], 2)
        self.assertIn("employee_workload", organization)
        self.assertEqual(organization["organization_counts"]["departments"], 5)

    def test_user_dashboard_only_counts_their_own_complaints(self):
        other = User.objects.create_user("other-owner@example.com", name="Other", password=PASSWORD)
        create_complaint(actor=other, title="Other issue", description="Private complaint", category="Electrical")
        client = APIClient()
        client.force_authenticate(self.owner)
        self.assertEqual(client.get("/api/dashboard/summary").data["stats"]["total"], 2)
