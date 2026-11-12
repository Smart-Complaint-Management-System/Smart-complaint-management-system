from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import DepartmentAdminProfile, EmployeeProfile, User
from accounts.roles import UserRole
from assignments.models import WorkAssignment
from assignments.services import (
    accept_assignment,
    assign_complaint,
    complete_assignment,
    update_assignment_progress,
)
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
        self.plumbing_admin = User.objects.create_user(
            "dashboard-plumbing-admin@example.com", name="Plumbing Admin", password=PASSWORD,
            role=UserRole.DEPARTMENT_ADMIN,
        )
        DepartmentAdminProfile.objects.create(user=self.plumbing_admin, department=self.plumbing)
        self.super_admin = User.objects.create_superuser(
            "dashboard-super@example.com", name="Super Admin", password=PASSWORD,
        )
        self.employee = User.objects.create_user(
            "dashboard-employee@example.com", name="Electrical Employee", password=PASSWORD,
            role=UserRole.EMPLOYEE,
        )
        self.employee_profile = EmployeeProfile.objects.create(
            user=self.employee, department=self.electrical, job_title="Technician",
        )
        self.other_employee = User.objects.create_user(
            "dashboard-other-employee@example.com", name="Plumbing Employee", password=PASSWORD,
            role=UserRole.EMPLOYEE,
        )
        self.other_employee_profile = EmployeeProfile.objects.create(
            user=self.other_employee, department=self.plumbing, job_title="Plumber",
        )
        self.owner = User.objects.create_user("dashboard-owner@example.com", name="Owner", password=PASSWORD)
        self.electrical_complaint = create_complaint(
            actor=self.owner, title="Socket repair", description="A socket needs repair", category="Electrical",
        )
        self.plumbing_complaint = create_complaint(
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

    def test_dashboard_endpoints_require_authentication(self):
        client = APIClient()
        self.assertEqual(client.get("/api/dashboard/summary").status_code, 401)
        self.assertEqual(
            client.get(f"/api/dashboard/employees/{self.employee_profile.pk}").status_code,
            401,
        )

    def test_employee_summary_contains_only_own_assignments_stats_and_history(self):
        completed_complaint = create_complaint(
            actor=self.owner, title="Fuse replacement", description="Replace the blown fuse", category="Electrical",
        )
        completed_assignment = assign_complaint(
            complaint=completed_complaint, actor=self.admin, employee=self.employee,
        )
        accept_assignment(assignment=completed_assignment, actor=self.employee)
        update_assignment_progress(
            assignment=completed_assignment, actor=self.employee, note="Repair started", progress_percent=40,
        )
        complete_assignment(assignment=completed_assignment, actor=self.employee, note="Fuse replaced")

        current_assignment = assign_complaint(
            complaint=self.electrical_complaint, actor=self.admin, employee=self.employee,
        )
        other_assignment = assign_complaint(
            complaint=self.plumbing_complaint, actor=self.plumbing_admin, employee=self.other_employee,
        )

        client = APIClient()
        client.force_authenticate(self.employee)
        response = client.get("/api/dashboard/summary")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["role"], UserRole.EMPLOYEE)
        self.assertEqual(response.data["stats"]["my_assignments"], 2)
        self.assertEqual(response.data["stats"]["new_assignments"], 1)
        self.assertEqual(response.data["stats"]["completed"], 1)
        self.assertEqual(
            {row["id"] for row in response.data["assignments"]},
            {completed_assignment.pk, current_assignment.pk},
        )
        self.assertEqual([row["id"] for row in response.data["work_history"]], [completed_assignment.pk])
        self.assertEqual(
            {row["complaintId"] for row in response.data["complaints"]},
            {completed_complaint.complaint_id, self.electrical_complaint.complaint_id},
        )
        self.assertNotIn(other_assignment.pk, {row["id"] for row in response.data["assignments"]})

        filtered = client.get("/api/dashboard/summary?status=Closed")
        self.assertEqual(filtered.status_code, 200, filtered.data)
        self.assertEqual(filtered.data["complaints"], [])

    def test_employee_detail_returns_empty_data_and_allows_only_authorized_scopes(self):
        client = APIClient()
        employee_url = f"/api/dashboard/employees/{self.employee_profile.pk}"

        client.force_authenticate(self.employee)
        own = client.get(employee_url)
        self.assertEqual(own.status_code, 200, own.data)
        self.assertEqual(own.data["employee"]["id"], self.employee.pk)
        self.assertEqual(own.data["stats"], {"assigned": 0, "accepted": 0, "in_progress": 0, "completed": 0, "overdue": 0})
        self.assertEqual(own.data["assignments"], [])
        self.assertEqual(own.data["work_history"], [])
        self.assertEqual(
            client.get(f"/api/dashboard/employees/{self.other_employee_profile.pk}").status_code,
            403,
        )

        client.force_authenticate(self.admin)
        department_detail = client.get(employee_url)
        self.assertEqual(department_detail.status_code, 200, department_detail.data)
        self.assertEqual(
            client.get(f"/api/dashboard/employees/{self.other_employee_profile.pk}").status_code,
            403,
        )

        client.force_authenticate(self.owner)
        self.assertEqual(client.get(employee_url).status_code, 403)
        self.assertEqual(client.get("/api/dashboard/employees/999999").status_code, 404)

        client.force_authenticate(self.super_admin)
        organization_detail = client.get(f"/api/dashboard/employees/{self.other_employee_profile.pk}")
        self.assertEqual(organization_detail.status_code, 200, organization_detail.data)
        self.assertEqual(organization_detail.data["employee"]["department"]["id"], self.plumbing.pk)

    def test_unknown_role_and_department_admin_without_profile_are_denied(self):
        client = APIClient()
        invalid_role = User.objects.create_user(
            "dashboard-invalid-role@example.com", name="Unknown Role", password=PASSWORD, role="AUDITOR",
        )
        client.force_authenticate(invalid_role)
        self.assertEqual(client.get("/api/dashboard/summary").status_code, 403)
        self.assertEqual(
            client.get(f"/api/dashboard/employees/{self.employee_profile.pk}").status_code,
            403,
        )

        profileless_admin = User.objects.create_user(
            "dashboard-profileless-admin@example.com", name="Profileless Admin", password=PASSWORD,
            role=UserRole.DEPARTMENT_ADMIN,
        )
        client.force_authenticate(profileless_admin)
        self.assertEqual(client.get("/api/dashboard/summary").status_code, 403)
