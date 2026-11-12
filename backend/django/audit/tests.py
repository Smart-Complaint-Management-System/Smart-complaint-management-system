from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import DepartmentAdminProfile, EmployeeProfile, User
from accounts.roles import UserRole
from assignments.services import assign_complaint
from audit.models import AuditEvent
from complaints.models import CategoryDepartmentMapping
from complaints.services import create_complaint
from departments.models import Department


PASSWORD = "Audit-Test-Strong-Passphrase#4821"


class AuditEventListAPITests(TestCase):
    def setUp(self):
        self.electrical = Department.objects.get(identifier="electrical")
        self.plumbing = Department.objects.get(identifier="plumbing")
        CategoryDepartmentMapping.objects.update_or_create(
            category="Audit Electrical", defaults={"department": self.electrical},
        )
        CategoryDepartmentMapping.objects.update_or_create(
            category="Audit Plumbing", defaults={"department": self.plumbing},
        )

        self.super_admin = User.objects.create_superuser(
            "audit-super@example.com", name="Audit Super Admin", password=PASSWORD,
        )
        self.department_admin = User.objects.create_user(
            "audit-electrical-admin@example.com", name="Electrical Admin", password=PASSWORD,
            role=UserRole.DEPARTMENT_ADMIN,
        )
        DepartmentAdminProfile.objects.create(user=self.department_admin, department=self.electrical)
        self.plumbing_admin = User.objects.create_user(
            "audit-plumbing-admin@example.com", name="Plumbing Admin", password=PASSWORD,
            role=UserRole.DEPARTMENT_ADMIN,
        )
        DepartmentAdminProfile.objects.create(user=self.plumbing_admin, department=self.plumbing)
        self.employee = User.objects.create_user(
            "audit-employee@example.com", name="Electrical Employee", password=PASSWORD,
            role=UserRole.EMPLOYEE,
        )
        EmployeeProfile.objects.create(user=self.employee, department=self.electrical)
        self.user = User.objects.create_user(
            "audit-user@example.com", name="Complaint Owner", password=PASSWORD,
        )
        other_user = User.objects.create_user(
            "audit-other-user@example.com", name="Other Owner", password=PASSWORD,
        )

        self.own_complaint = create_complaint(
            actor=self.user, title="Electrical complaint", description="Electrical repair needed.",
            category="Audit Electrical",
        )
        self.foreign_complaint = create_complaint(
            actor=other_user, title="Plumbing complaint", description="Plumbing repair needed.",
            category="Audit Plumbing",
        )
        assignment = assign_complaint(
            complaint=self.own_complaint, actor=self.department_admin, employee=self.employee,
        )
        self.assigned_event = AuditEvent.objects.get(
            complaint=self.own_complaint, action="EMPLOYEE_ASSIGNED",
        )
        self.owner_complaint_event = AuditEvent.objects.create(
            actor=self.department_admin,
            action="COMPLAINT_REVIEWED",
            complaint=self.own_complaint,
            department=self.electrical,
            previous_value={"status": "Submitted"},
            new_value={"status": "Assigned"},
            metadata={"assignment_id": assignment.pk},
        )
        self.employee_only_event = AuditEvent.objects.create(
            actor=self.employee,
            action="EMPLOYEE_PROFILE_ACTION",
            department=self.electrical,
        )
        self.foreign_event = AuditEvent.objects.create(
            actor=self.plumbing_admin,
            action="PLUMBING_ACTION",
            complaint=self.foreign_complaint,
            department=self.plumbing,
        )
        self.system_event = AuditEvent.objects.create(action="SYSTEM_ACTION")

    def test_endpoint_requires_authentication(self):
        response = APIClient().get("/api/audit-events")
        self.assertEqual(response.status_code, 401)

    def test_super_admin_sees_all_events_and_serialized_fields(self):
        client = APIClient()
        client.force_authenticate(self.super_admin)

        response = client.get("/api/audit-events")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], AuditEvent.objects.count())
        self.assertEqual(len(response.data["audit_events"]), AuditEvent.objects.count())
        event = next(row for row in response.data["audit_events"] if row["id"] == self.assigned_event.pk)
        self.assertEqual(event["actor"]["id"], self.department_admin.pk)
        self.assertEqual(event["actor_role"], UserRole.DEPARTMENT_ADMIN)
        self.assertEqual(event["complaint_id"], self.own_complaint.complaint_id)
        self.assertEqual(event["department_id"], self.electrical.pk)
        self.assertEqual(event["department_name"], self.electrical.name)
        self.assertEqual(event["new_value"]["employee_id"], self.employee.pk)

        system_event = next(row for row in response.data["audit_events"] if row["id"] == self.system_event.pk)
        self.assertIsNone(system_event["actor"])
        self.assertIsNone(system_event["complaint_id"])
        self.assertIsNone(system_event["department_name"])

    def test_department_admin_sees_only_department_events_and_filters_by_complaint_and_action(self):
        client = APIClient()
        client.force_authenticate(self.department_admin)

        response = client.get("/api/audit-events")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            {row["id"] for row in response.data["audit_events"]},
            set(AuditEvent.objects.filter(department=self.electrical).values_list("pk", flat=True)),
        )

        filtered = client.get(
            "/api/audit-events",
            {"complaint": self.own_complaint.complaint_id, "action": "COMPLAINT_REVIEWED"},
        )
        self.assertEqual(filtered.status_code, 200, filtered.data)
        self.assertEqual([row["id"] for row in filtered.data["audit_events"]], [self.owner_complaint_event.pk])

    def test_employee_sees_actor_and_assigned_work_events_without_duplicates(self):
        client = APIClient()
        client.force_authenticate(self.employee)

        response = client.get("/api/audit-events")

        self.assertEqual(response.status_code, 200, response.data)
        event_ids = [row["id"] for row in response.data["audit_events"]]
        expected_ids = set(
            AuditEvent.objects.filter(complaint=self.own_complaint).values_list("pk", flat=True)
        )
        expected_ids.add(self.employee_only_event.pk)
        self.assertCountEqual(
            event_ids,
            expected_ids,
        )
        self.assertEqual(len(event_ids), len(set(event_ids)))
        self.assertNotIn(self.foreign_event.pk, event_ids)
        self.assertNotIn(self.system_event.pk, event_ids)

    def test_regular_user_sees_only_events_for_owned_complaints(self):
        client = APIClient()
        client.force_authenticate(self.user)

        response = client.get("/api/audit-events")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            {row["id"] for row in response.data["audit_events"]},
            set(AuditEvent.objects.filter(complaint=self.own_complaint).values_list("pk", flat=True)),
        )

    def test_invalid_role_is_denied_and_unknown_filters_return_empty_results(self):
        invalid_role_user = User.objects.create_user(
            "audit-invalid-role@example.com", name="Invalid Role", password=PASSWORD, role="AUDITOR",
        )
        client = APIClient()
        client.force_authenticate(invalid_role_user)
        self.assertEqual(client.get("/api/audit-events").status_code, 403)

        client.force_authenticate(self.super_admin)
        for params in (
            {"complaint": "DOES-NOT-EXIST"},
            {"action": "UNKNOWN_ACTION"},
            {"complaint": self.own_complaint.complaint_id, "action": "UNKNOWN_ACTION"},
        ):
            with self.subTest(params=params):
                response = client.get("/api/audit-events", params)
                self.assertEqual(response.status_code, 200, response.data)
                self.assertEqual(response.data, {"count": 0, "audit_events": []})

    def test_department_admin_without_profile_gets_no_events(self):
        profileless_admin = User.objects.create_user(
            "audit-profileless-admin@example.com", name="Profileless Admin", password=PASSWORD,
            role=UserRole.DEPARTMENT_ADMIN,
        )
        client = APIClient()
        client.force_authenticate(profileless_admin)

        response = client.get("/api/audit-events")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data, {"count": 0, "audit_events": []})
