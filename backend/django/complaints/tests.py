from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import DepartmentAdminProfile, User
from accounts.roles import UserRole
from audit.models import AuditEvent
from complaints.models import CategoryDepartmentMapping, Complaint, ComplaintStatusHistory
from complaints.priority import assess_priority
from complaints.services import create_complaint, update_complaint
from departments.models import Department


PASSWORD = "Independent-Test-Passphrase#7291"


class ComplaintWorkflowTests(TestCase):
    def setUp(self):
        self.electrical = Department.objects.create(identifier="test-electrical", name="Electrical")
        self.plumbing = Department.objects.create(identifier="test-plumbing", name="Plumbing")
        CategoryDepartmentMapping.objects.update_or_create(category="Electrical", defaults={"department": self.electrical})
        CategoryDepartmentMapping.objects.update_or_create(category="Plumbing", defaults={"department": self.plumbing})
        self.user = User.objects.create_user("owner@example.com", name="Owner", password=PASSWORD)
        self.electrical_admin = User.objects.create_user(
            "electrical-admin@example.com", name="Electrical Admin", password=PASSWORD,
            role=UserRole.DEPARTMENT_ADMIN,
        )
        DepartmentAdminProfile.objects.create(user=self.electrical_admin, department=self.electrical)
        self.plumbing_admin = User.objects.create_user(
            "plumbing-admin@example.com", name="Plumbing Admin", password=PASSWORD,
            role=UserRole.DEPARTMENT_ADMIN,
        )
        DepartmentAdminProfile.objects.create(user=self.plumbing_admin, department=self.plumbing)

    def test_category_is_routed_by_server_and_client_department_is_ignored(self):
        client = APIClient()
        client.force_authenticate(self.user)
        response = client.post("/api/complaints", {
            "title": "Broken socket", "description": "Exposed live wiring in a busy hallway",
            "category": "Electrical", "department_id": self.plumbing.pk,
        }, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        complaint = Complaint.objects.get()
        self.assertEqual(complaint.department, self.electrical)
        self.assertEqual(complaint.priority, Complaint.Priority.CRITICAL)
        self.assertEqual(complaint.status_history.count(), 1)

    def test_department_admins_cannot_list_or_fetch_another_departments_complaints(self):
        electrical_complaint = create_complaint(
            actor=self.user, title="Outlet", description="Socket is damaged", category="Electrical",
        )
        client = APIClient()
        client.force_authenticate(self.plumbing_admin)
        self.assertEqual(client.get("/api/admin/complaints").data["count"], 0)
        self.assertEqual(client.get(f"/api/admin/complaints/{electrical_complaint.pk}").status_code, 404)
        client.force_authenticate(self.electrical_admin)
        self.assertEqual(client.get("/api/admin/complaints").data["count"], 1)

    def test_priority_examples_are_transparent_and_ranked(self):
        exposed = assess_priority("Exposed electrical wire", "Live wire sparks near students", "Electrical")
        leak = assess_priority("Water leakage", "Water is leaking in a room", "Plumbing")
        minor = assess_priority("Loose handle", "A cabinet handle needs tightening", "Furniture")
        self.assertEqual(exposed["priority"], Complaint.Priority.CRITICAL)
        self.assertGreaterEqual(exposed["score"], 76)
        self.assertGreater(leak["score"], minor["score"])
        self.assertTrue(exposed["reasons"])

    def test_critical_safety_priority_is_not_silently_downgraded_by_owner_edit(self):
        complaint = create_complaint(
            actor=self.user, title="Exposed wire", description="Live exposed electrical wiring", category="Electrical",
        )
        update_complaint(
            complaint=complaint, actor=self.user,
            changes={"title": "Minor issue", "description": "Please inspect", "category": "Electrical"},
        )
        complaint.refresh_from_db()
        self.assertEqual(complaint.priority, Complaint.Priority.CRITICAL)
        self.assertTrue(AuditEvent.objects.filter(complaint=complaint, action="COMPLAINT_UPDATED").exists())

    def test_resolution_and_closure_require_resolution_and_record_history(self):
        complaint = create_complaint(
            actor=self.user, title="Broken fixture", description="Fixture is broken", category="Electrical",
        )
        client = APIClient()
        client.force_authenticate(self.electrical_admin)
        close_url = f"/api/admin/complaints/{complaint.pk}/status"
        self.assertEqual(client.patch(close_url, {"status": Complaint.Status.CLOSED}, format="json").status_code, 400)
        client.patch(f"/api/admin/complaints/{complaint.pk}/resolution", {"resolution": "Repaired"}, format="json")
        self.assertEqual(client.patch(close_url, {"status": Complaint.Status.IN_PROGRESS}, format="json").status_code, 200)
        self.assertEqual(client.patch(close_url, {"status": Complaint.Status.RESOLVED}, format="json").status_code, 200)
        self.assertEqual(client.patch(close_url, {"status": Complaint.Status.CLOSED}, format="json").status_code, 200)
        complaint.refresh_from_db()
        self.assertEqual(complaint.status, Complaint.Status.CLOSED)
        self.assertEqual(ComplaintStatusHistory.objects.filter(complaint=complaint).count(), 4)
        self.assertTrue(AuditEvent.objects.filter(complaint=complaint, action="COMPLAINT_CLOSED").exists())

    def test_unauthenticated_complaint_access_is_rejected(self):
        self.assertEqual(APIClient().get("/api/complaints").status_code, 401)
