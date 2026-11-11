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

    def test_super_admin_can_view_complaints_across_departments(self):
        create_complaint(
            actor=self.user,
            title="Electrical issue",
            description="Damaged electrical socket",
            category="Electrical",
        )
        create_complaint(
            actor=self.user,
            title="Plumbing issue",
            description="Water leakage",
            category="Plumbing",
        )

        super_admin = User.objects.create_superuser(
            "super-admin-list@example.com",
            name="Super Admin",
            password=PASSWORD,
        )

        client = APIClient()
        client.force_authenticate(super_admin)

        response = client.get("/api/admin/complaints")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["count"], 2)
        self.assertEqual(len(response.data["complaints"]), 2)

        for complaint in response.data["complaints"]:
            self.assertNotIn("password", complaint)
            self.assertNotIn("token", complaint)

            if complaint.get("submittedBy"):
                self.assertNotIn("password", complaint["submittedBy"])
                self.assertNotIn("token", complaint["submittedBy"])

    def test_regular_user_cannot_view_admin_complaint_list(self):
        client = APIClient()
        client.force_authenticate(self.user)

        response = client.get("/api/admin/complaints")

        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_user_cannot_view_admin_complaint_list(self):
        client = APIClient()

        response = client.get("/api/admin/complaints")

        self.assertEqual(response.status_code, 401)
        
    def test_admin_can_view_selected_complaint_details(self):
         complaint = create_complaint(
            actor=self.user,
            title="Broken electrical socket",
            description="Socket is damaged in the classroom",
            category="Electrical",
        )

         client = APIClient()
         client.force_authenticate(self.electrical_admin)

         response = client.get(f"/api/admin/complaints/{complaint.pk}")

         self.assertEqual(response.status_code, 200, response.data)

         complaint_data = response.data["complaint"]

         self.assertEqual(complaint_data["title"], "Broken electrical socket")
         self.assertEqual(
            complaint_data["description"],
            "Socket is damaged in the classroom",
        )
         self.assertNotIn("password", complaint_data)
         self.assertNotIn("token", complaint_data)

        
   

    def test_admin_complaint_details_returns_404_for_unknown_id(self):
        client = APIClient()
        client.force_authenticate(self.electrical_admin)

        response = client.get("/api/admin/complaints/999999")

        self.assertEqual(response.status_code, 404)

    def test_regular_user_cannot_view_admin_complaint_details(self):
        complaint = create_complaint(
            actor=self.user,
            title="Broken light",
            description="Light is not working",
            category="Electrical",
        )

        client = APIClient()
        client.force_authenticate(self.user)

        response = client.get(f"/api/admin/complaints/{complaint.pk}")

        self.assertEqual(response.status_code, 403)

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
            actor=self.user,
            title="Broken fixture",
            description="Fixture is broken",
            category="Electrical",
        )

        client = APIClient()
        client.force_authenticate(self.electrical_admin)

        close_url = f"/api/admin/complaints/{complaint.pk}/status"

        # Closing without a resolution must be rejected.
        response = client.patch(
            close_url,
            {"status": Complaint.Status.CLOSED},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

        # Add resolution.
        client.patch(
            f"/api/admin/complaints/{complaint.pk}/resolution",
            {"resolution": "Repaired"},
            format="json",
        )

        # Perform valid status transitions.
        for status in [
            Complaint.Status.IN_PROGRESS,
            Complaint.Status.RESOLVED,
            Complaint.Status.CLOSED,
        ]:
            response = client.patch(
                close_url,
                {"status": status},
                format="json",
            )
            self.assertEqual(response.status_code, 200, response.data)

        complaint.refresh_from_db()

        # Verify final status.
        self.assertEqual(complaint.status, Complaint.Status.CLOSED)

        # Verify status history.
        history = ComplaintStatusHistory.objects.filter(
            complaint=complaint
        ).order_by("created_at")

        self.assertEqual(history.count(), 4)

        final_history = history.last()
        self.assertEqual(final_history.actor, self.electrical_admin)
        self.assertEqual(
            final_history.previous_status,
            Complaint.Status.RESOLVED,
        )
        self.assertEqual(
            final_history.new_status,
            Complaint.Status.CLOSED,
        )
        self.assertIsNotNone(final_history.created_at)

        # Verify audit event.
        audit_event = AuditEvent.objects.filter(
            complaint=complaint,
            action="COMPLAINT_CLOSED",
        ).first()

        self.assertIsNotNone(audit_event)
        self.assertEqual(audit_event.actor, self.electrical_admin)
        self.assertEqual(
            audit_event.previous_value["status"],
            Complaint.Status.RESOLVED,
        )
        self.assertEqual(
            audit_event.new_value["status"],
            Complaint.Status.CLOSED,
        )
        self.assertIsNotNone(audit_event.created_at)

        # Verify complaint owner can retrieve updated status.
        client.force_authenticate(self.user)

        response = client.get(f"/api/complaints/{complaint.pk}")

        self.assertEqual(response.status_code, 200, response.data)

        owner_complaint = response.data["complaint"]
        self.assertEqual(owner_complaint["status"], Complaint.Status.CLOSED)
        self.assertEqual(owner_complaint["resolution"], "Repaired")

    def test_unauthenticated_complaint_access_is_rejected(self):
        self.assertEqual(APIClient().get("/api/complaints").status_code, 401)

# Sprint 3: US-015 admin status update tests

    def test_regular_user_cannot_update_complaint_status(self):
        complaint = create_complaint(
            actor=self.user,
            title="Broken light",
            description="Light is not working",
            category="Electrical",
        )
        client = APIClient()
        client.force_authenticate(self.user)

        response = client.patch(
            f"/api/admin/complaints/{complaint.pk}/status",
            {"status": Complaint.Status.IN_PROGRESS},
            format="json",
        )

        self.assertEqual(response.status_code, 403)
        complaint.refresh_from_db()
        self.assertEqual(complaint.status, Complaint.Status.SUBMITTED)

    def test_department_admin_cannot_update_another_departments_complaint(self):
        complaint = create_complaint(
            actor=self.user,
            title="Water leakage",
            description="Pipe is leaking",
            category="Plumbing",
        )
        client = APIClient()
        client.force_authenticate(self.electrical_admin)

        response = client.patch(
            f"/api/admin/complaints/{complaint.pk}/status",
            {"status": Complaint.Status.IN_PROGRESS},
            format="json",
        )

        self.assertEqual(response.status_code, 404)
        complaint.refresh_from_db()
        self.assertEqual(complaint.status, Complaint.Status.SUBMITTED)

    def test_admin_cannot_skip_invalid_status_transition(self):
        complaint = create_complaint(
            actor=self.user,
            title="Broken socket",
            description="Socket is damaged",
            category="Electrical",
        )
        client = APIClient()
        client.force_authenticate(self.electrical_admin)

        response = client.patch(
            f"/api/admin/complaints/{complaint.pk}/status",
            {"status": Complaint.Status.CLOSED},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        complaint.refresh_from_db()
        self.assertEqual(complaint.status, Complaint.Status.SUBMITTED)

    def test_admin_can_update_complaint_status_successfully(self):
        complaint = create_complaint(
            actor=self.user,
            title="Broken socket",
            description="Socket is damaged",
            category="Electrical",
        )
        client = APIClient()
        client.force_authenticate(self.electrical_admin)

        response = client.patch(
            f"/api/admin/complaints/{complaint.pk}/status",
            {"status": Complaint.Status.IN_PROGRESS},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)

        complaint.refresh_from_db()
        self.assertEqual(complaint.status, Complaint.Status.IN_PROGRESS)
        self.assertTrue(
            ComplaintStatusHistory.objects.filter(
                complaint=complaint,
                actor=self.electrical_admin,
                new_status=Complaint.Status.IN_PROGRESS,
            ).exists()
        )