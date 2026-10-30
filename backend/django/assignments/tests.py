from django.test import TestCase
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from accounts.models import DepartmentAdminProfile, EmployeeProfile, User
from accounts.roles import UserRole
from assignments.models import WorkAssignment
from assignments.services import assign_complaint, accept_assignment, complete_assignment, verify_assignment
from audit.models import AuditEvent
from complaints.models import Complaint
from complaints.services import create_complaint
from departments.models import Department
from notifications.models import Notification


PASSWORD = "Independent-Test-Passphrase#7291"


class AssignmentWorkflowTests(TestCase):
    def setUp(self):
        self.electrical = Department.objects.get(identifier="electrical")
        self.plumbing = Department.objects.get(identifier="plumbing")
        self.owner = User.objects.create_user("assignment-owner@example.com", name="Owner", password=PASSWORD)
        self.admin = User.objects.create_user(
            "assignment-admin@example.com", name="Electrical Admin", password=PASSWORD,
            role=UserRole.DEPARTMENT_ADMIN,
        )
        DepartmentAdminProfile.objects.create(user=self.admin, department=self.electrical)
        self.worker = User.objects.create_user(
            "worker@example.com", name="Electrician", password=PASSWORD, role=UserRole.EMPLOYEE,
        )
        EmployeeProfile.objects.create(user=self.worker, department=self.electrical, job_title="Electrician")
        self.other_worker = User.objects.create_user(
            "plumber@example.com", name="Plumber", password=PASSWORD, role=UserRole.EMPLOYEE,
        )
        EmployeeProfile.objects.create(user=self.other_worker, department=self.plumbing, job_title="Plumber")
        self.complaint = create_complaint(
            actor=self.owner, title="Broken outlet", description="Socket not working", category="Electrical",
        )

    def test_admin_cannot_assign_a_complaint_to_an_employee_in_another_department(self):
        with self.assertRaises(ValidationError):
            assign_complaint(complaint=self.complaint, actor=self.admin, employee=self.other_worker)
        self.assertFalse(WorkAssignment.objects.exists())

    def test_super_admin_can_make_a_reasoned_cross_department_override(self):
        super_admin = User.objects.create_superuser(
            "super-admin@example.com", name="Super Admin", password=PASSWORD,
        )
        with self.assertRaises(ValidationError):
            assign_complaint(complaint=self.complaint, actor=super_admin, employee=self.other_worker)
        assign_complaint(complaint=self.complaint, actor=self.admin, employee=self.worker)
        assignment = assign_complaint(
            complaint=self.complaint, actor=super_admin, employee=self.other_worker,
            override_reason="Electrical team requested a plumbing specialist.",
        )
        self.complaint.refresh_from_db()
        self.assertEqual(self.complaint.department, self.plumbing)
        self.assertEqual(assignment.employee, self.other_worker)
        self.assertTrue(AuditEvent.objects.filter(complaint=self.complaint, action="DEPARTMENT_REASSIGNED").exists())
        self.assertTrue(Notification.objects.filter(recipient=self.worker, kind="ASSIGNMENT_REASSIGNED").exists())

    def test_employee_sees_only_own_assignments_and_cannot_close_complaint(self):
        assignment = assign_complaint(complaint=self.complaint, actor=self.admin, employee=self.worker)
        client = APIClient()
        client.force_authenticate(self.other_worker)
        self.assertEqual(client.get("/api/assignments/me").data["count"], 0)
        self.assertEqual(client.post(f"/api/assignments/{assignment.pk}/complete", {}, format="json").status_code, 404)
        self.assertEqual(client.patch(f"/api/admin/complaints/{self.complaint.pk}/status", {"status": "Closed"}, format="json").status_code, 403)

    def test_assignment_progress_completion_and_admin_verification_are_audited(self):
        assignment = assign_complaint(complaint=self.complaint, actor=self.admin, employee=self.worker)
        accept_assignment(assignment=assignment, actor=self.worker)
        completed = complete_assignment(assignment=assignment, actor=self.worker, note="Replaced damaged socket.")
        self.assertEqual(completed.status, WorkAssignment.Status.COMPLETED)
        verified = verify_assignment(assignment=completed, actor=self.admin, resolution="Socket replaced and tested.")
        self.assertEqual(verified.status, WorkAssignment.Status.VERIFIED)
        self.complaint.refresh_from_db()
        self.assertEqual(self.complaint.status, Complaint.Status.RESOLVED)
        actions = set(AuditEvent.objects.filter(complaint=self.complaint).values_list("action", flat=True))
        self.assertTrue({"EMPLOYEE_ASSIGNED", "ASSIGNMENT_ACCEPTED", "WORK_COMPLETED", "WORK_VERIFIED", "RESOLUTION_ADDED"}.issubset(actions))
        self.assertTrue(Notification.objects.filter(recipient=self.worker).exists())

    def test_assignment_endpoints_require_jwt(self):
        self.assertEqual(APIClient().get("/api/assignments/me").status_code, 401)
