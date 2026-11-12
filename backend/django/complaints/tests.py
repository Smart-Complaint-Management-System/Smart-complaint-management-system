from types import SimpleNamespace
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.utils import timezone
from rest_framework.exceptions import ValidationError, ValidationError as DRFValidationError
from rest_framework.test import APIClient, APIRequestFactory

from accounts.models import DepartmentAdminProfile, EmployeeProfile, User
from accounts.roles import UserRole
from audit.models import AuditEvent
from notifications.models import Notification
from complaints.models import (
    CategoryDepartmentMapping,
    Complaint,
    ComplaintAttachment,
    ComplaintStatusHistory,
    PriorityPolicy,
)
from complaints.priority import assess_priority
from complaints.serializers import (
    AttachmentSerializer,
    CategoryDepartmentMappingSerializer,
    ComplaintAttachmentCreateSerializer,
    ComplaintCreateSerializer,
    ComplaintReadSerializer,
    ComplaintUpdateSerializer,
    DepartmentReassignmentSerializer,
    PriorityOverrideSerializer,
    PriorityPolicySerializer,
    ReopenSerializer,
    ResolutionSerializer,
    StatusChangeSerializer,
)
from assignments.models import WorkAssignment
from assignments.services import (
    accept_assignment,
    assign_complaint,
    complete_assignment,
    update_assignment_progress,
)
from complaints.services import (
    actor_can_manage_complaint,
    create_complaint,
    override_priority,
    reopen_complaint,
    save_resolution,
    transition_complaint,
    update_complaint,
)
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
        self.worker = User.objects.create_user(
            "electrical-worker@example.com", name="Electrical Worker", password=PASSWORD,
            role=UserRole.EMPLOYEE,
        )
        EmployeeProfile.objects.create(user=self.worker, department=self.electrical, job_title="Technician")
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

    def test_staff_roles_cannot_use_regular_user_complaint_reads(self):
        complaint = create_complaint(
            actor=self.user, title="Private read boundary", description="Owner-only complaint.", category="Electrical",
        )
        super_admin = User.objects.create_superuser("read-boundary-admin@example.com", name="Super Admin", password=PASSWORD)
        client = APIClient()
        for staff in (super_admin, self.electrical_admin, self.worker):
            client.force_authenticate(staff)
            for path in (
                "/api/complaints",
                "/api/user/complaints",
                f"/api/complaints/{complaint.pk}",
                f"/api/user/complaints/{complaint.pk}",
                f"/api/complaints/{complaint.pk}/updates",
            ):
                with self.subTest(role=staff.role, path=path):
                    self.assertEqual(client.get(path).status_code, 403)
        client.force_authenticate(self.user)
        self.assertEqual(client.get(f"/api/complaints/{complaint.pk}").status_code, 200)
        self.assertEqual(client.get(f"/api/complaints/{complaint.pk}/updates").status_code, 200)

    def test_unauthenticated_user_cannot_view_admin_complaint_list(self):
        client = APIClient()

        response = client.get("/api/admin/complaints")

        self.assertEqual(response.status_code, 401)

    def test_regular_user_lists_only_own_complaints_despite_query_parameters(self):
        own_complaint = create_complaint(
            actor=self.user,
            title="My private complaint",
            description="A complaint belonging to the signed-in user.",
            category="Electrical",
        )
        other_user = User.objects.create_user(
            "other-owner@example.com",
            name="Other Owner",
            password=PASSWORD,
        )
        other_complaint = create_complaint(
            actor=other_user,
            title="Other owner's confidential complaint",
            description="This must not appear in another user's results.",
            category="Electrical",
        )

        client = APIClient()
        client.force_authenticate(self.user)

        for endpoint in ("/api/complaints", "/api/user/complaints"):
            response = client.get(
                endpoint,
                {
                    "submitted_by": other_user.pk,
                    "owner": other_user.pk,
                    "search": other_complaint.complaint_id,
                },
            )

            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(response.data["count"], 0)
            self.assertNotIn(
                other_complaint.complaint_id,
                str(response.data),
            )

            response = client.get(
                endpoint,
                {"submitted_by": other_user.pk, "owner": other_user.pk},
            )

            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(
                [item["complaintId"] for item in response.data["complaints"]],
                [own_complaint.complaint_id],
            )
            self.assertNotIn(other_complaint.complaint_id, str(response.data))

    def test_regular_user_cannot_fetch_another_users_complaint_or_updates_by_any_id(self):
        other_user = User.objects.create_user(
            "other-lookup-owner@example.com",
            name="Other Lookup Owner",
            password=PASSWORD,
        )
        other_complaint = create_complaint(
            actor=other_user,
            title="Private complaint for IDOR test",
            description="Only its owner may retrieve this complaint.",
            category="Electrical",
        )
        other_complaint.legacy_mongo_id = "legacy-private-complaint"
        other_complaint.save(update_fields=["legacy_mongo_id"])

        client = APIClient()
        client.force_authenticate(self.user)
        lookups = (
            str(other_complaint.pk),
            other_complaint.complaint_id,
            other_complaint.legacy_mongo_id,
        )

        for lookup in lookups:
            for path in (
                f"/api/complaints/{lookup}",
                f"/api/user/complaints/{lookup}",
                f"/api/complaints/{lookup}/updates",
            ):
                response = client.get(
                    path,
                    {"id": self.user.pk, "complaint_id": "my-complaint"},
                )
                self.assertEqual(response.status_code, 404, (path, response.data))
                self.assertNotIn(other_complaint.complaint_id, str(response.data))

    def test_complaint_owner_receives_persisted_status_history_and_updates(self):
        complaint = create_complaint(
            actor=self.user,
            title="Tracked complaint",
            description="A complaint with status history and an update.",
            category="Electrical",
        )
        assignment = assign_complaint(complaint=complaint, actor=self.electrical_admin, employee=self.worker)
        assignment = accept_assignment(assignment=assignment, actor=self.worker)
        update_assignment_progress(
            assignment=assignment, actor=self.worker, note="Work has started.", progress_percent=25,
        )
        complaint.refresh_from_db()
        history = complaint.status_history.get(new_status=Complaint.Status.IN_PROGRESS)
        AuditEvent.objects.create(
            actor=self.electrical_admin,
            actor_role=UserRole.DEPARTMENT_ADMIN,
            action="COMPLAINT_RESPONSE_ADDED",
            complaint=complaint,
            new_value={"resolution": "The repair is underway."},
        )

        client = APIClient()
        client.force_authenticate(self.user)

        detail_response = client.get(f"/api/complaints/{complaint.pk}")
        updates_response = client.get(f"/api/complaints/{complaint.pk}/updates")

        self.assertEqual(detail_response.status_code, 200, detail_response.data)
        complaint.refresh_from_db()
        self.assertEqual(complaint.status, Complaint.Status.IN_PROGRESS)
        self.assertEqual(
            detail_response.data["complaint"]["status"],
            Complaint.Status.IN_PROGRESS,
        )
        self.assertEqual(
            next(
                item["id"]
                for item in detail_response.data["complaint"]["statusHistory"]
                if item["new_status"] == Complaint.Status.IN_PROGRESS
            ),
            history.pk,
        )
        transition_history = next(
            item
            for item in detail_response.data["complaint"]["statusHistory"]
            if item["id"] == history.pk
        )
        self.assertEqual(transition_history["previous_status"], Complaint.Status.ACCEPTED)
        self.assertEqual(transition_history["new_status"], Complaint.Status.IN_PROGRESS)
        self.assertEqual(updates_response.status_code, 200, updates_response.data)
        self.assertEqual(updates_response.data["currentStatus"], Complaint.Status.IN_PROGRESS)
        self.assertTrue(
            any(
                event["details"].get("new", {}).get("resolution")
                == "The repair is underway."
                for event in updates_response.data["updates"]
            ),
            updates_response.data,
        )

    def test_regular_user_cannot_patch_another_users_complaint_but_can_edit_their_own(self):
        other_user = User.objects.create_user(
            "other-patch-owner@example.com",
            name="Other Patch Owner",
            password=PASSWORD,
        )
        other_complaint = create_complaint(
            actor=other_user,
            title="Other user's complaint",
            description="Original private description.",
            category="Electrical",
        )

        client = APIClient()
        client.force_authenticate(self.user)
        response = client.patch(
            f"/api/complaints/{other_complaint.pk}",
            {"description": "Attempted unauthorized change."},
            format="json",
        )

        self.assertIn(response.status_code, (403, 404), response.data)
        other_complaint.refresh_from_db()
        self.assertEqual(other_complaint.description, "Original private description.")
        self.assertEqual(other_complaint.status, Complaint.Status.SUBMITTED)

        own_complaint = create_complaint(
            actor=self.user,
            title="My editable complaint",
            description="My original description.",
            category="Electrical",
        )
        response = client.patch(
            f"/api/complaints/{own_complaint.pk}",
            {"description": "Updated by its owner."},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        own_complaint.refresh_from_db()
        self.assertEqual(own_complaint.description, "Updated by its owner.")
        self.assertEqual(own_complaint.status, Complaint.Status.SUBMITTED)

        
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

    def test_priority_threshold_boundaries(self):
        thresholds = (
            (20, Complaint.Priority.LOW),
            (21, Complaint.Priority.MEDIUM),
            (45, Complaint.Priority.MEDIUM),
            (46, Complaint.Priority.HIGH),
            (75, Complaint.Priority.HIGH),
            (76, Complaint.Priority.CRITICAL),
        )
        for score, expected_priority in thresholds:
            with self.subTest(score=score):
                policy = SimpleNamespace(
                    safety_weight=0,
                    affected_users_weight=0,
                    service_disruption_weight=0,
                    urgency_weight=score,
                    medium_threshold=21,
                    high_threshold=46,
                    critical_threshold=76,
                    safety_keywords=["safety-signal"],
                    affected_users_keywords=["crowd-signal"],
                    disruption_keywords=["outage-signal"],
                    urgency_keywords=["urgent-signal"],
                )
                result = assess_priority("", "urgent-signal", "Other", policy=policy)
                self.assertEqual(result["score"], score)
                self.assertEqual(result["priority"], expected_priority)

    def test_affected_people_counts_and_textual_fallbacks(self):
        policy = PriorityPolicy(
            safety_weight=0,
            affected_users_weight=20,
            service_disruption_weight=0,
            urgency_weight=0,
            safety_keywords=["safety-signal"],
            affected_users_keywords=["wide-signal"],
            disruption_keywords=["outage-signal"],
            urgency_keywords=["urgent-signal"],
        )
        cases = (
            ("0 students affected", 0),
            ("50 students affected", 20),
            ("10 students affected", 15),
            ("2 students affected", 10),
            ("1 residents affected", 4),
            ("1 resident affected", 0),
            ("wide-signal", 20),
            ("building issue", 15),
            ("classroom issue", 7),
            ("single fixture issue", 0),
        )
        for description, expected_score in cases:
            with self.subTest(description=description):
                self.assertEqual(
                    assess_priority("", description, "Other", policy=policy)["score"],
                    expected_score,
                )

    def test_priority_factors_reasons_and_critical_safety_trigger(self):
        policy = PriorityPolicy(
            safety_weight=40,
            affected_users_weight=20,
            service_disruption_weight=20,
            urgency_weight=20,
            safety_keywords=["danger signal", "unsafe signal", "risk signal", "fourth signal"],
            affected_users_keywords=["whole building"],
            disruption_keywords=["power outage", "water outage", "network outage"],
            urgency_keywords=["urgent signal"],
        )

        ordinary_safety = assess_priority("", "danger signal", "Other", policy=policy)
        self.assertEqual(ordinary_safety["score"], 40)
        self.assertFalse(ordinary_safety["critical_safety_trigger"])
        self.assertIn("danger signal", ordinary_safety["reasons"][0])

        electrical_safety = assess_priority("", "danger signal near a socket", "Electrical", policy=policy)
        self.assertTrue(electrical_safety["critical_safety_trigger"])
        self.assertEqual(electrical_safety["score"], 76)

        urgent_safety = assess_priority("", "danger signal urgent signal", "Other", policy=policy)
        self.assertTrue(urgent_safety["critical_safety_trigger"])
        self.assertEqual(urgent_safety["score"], 76)

        combined = assess_priority(
            "", "danger signal whole building power outage urgent signal", "Other", policy=policy,
        )
        self.assertEqual(combined["score"], 100)
        self.assertEqual(combined["priority"], Complaint.Priority.CRITICAL)
        self.assertTrue(any("Service disruption" in reason for reason in combined["reasons"]))
        self.assertTrue(any("active or urgent" in reason for reason in combined["reasons"]))

        partial = assess_priority("", "service is intermittent", "Other", policy=policy)
        self.assertEqual(partial["score"], 12)
        self.assertIn("Partial service disruption", partial["reasons"][-1])

    def test_empty_custom_keyword_lists_use_default_signals_and_empty_input_is_low(self):
        policy = PriorityPolicy(
            safety_weight=40,
            affected_users_weight=20,
            service_disruption_weight=20,
            urgency_weight=20,
            safety_keywords=[],
            affected_users_keywords=[],
            disruption_keywords=[],
            urgency_keywords=[],
        )
        result = assess_priority("Exposed wire", "urgent", "Electrical", policy=policy)
        self.assertEqual(result["priority"], Complaint.Priority.CRITICAL)
        self.assertTrue(result["critical_safety_trigger"])

        empty = assess_priority("", "", "", policy=policy)
        self.assertEqual(empty["score"], 0)
        self.assertEqual(empty["priority"], Complaint.Priority.LOW)
        self.assertEqual(len(empty["reasons"]), 1)
        self.assertFalse(empty["critical_safety_trigger"])

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

        # Managers cannot close before the assignment and verification lifecycle.
        response = client.patch(
            close_url,
            {"status": Complaint.Status.CLOSED},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

        assignment = assign_complaint(
            complaint=complaint, actor=self.electrical_admin, employee=self.worker,
        )
        assignment = accept_assignment(assignment=assignment, actor=self.worker)
        update_assignment_progress(
            assignment=assignment, actor=self.worker, note="Repair started.", progress_percent=50,
        )
        assignment.refresh_from_db()
        assignment = complete_assignment(assignment=assignment, actor=self.worker, note="Repaired")
        response = client.patch(
            f"/api/admin/complaints/{complaint.pk}/resolution",
            {"resolution": "Repaired"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        stale_resolved_complaint = Complaint.objects.get(pk=complaint.pk)

        response = client.patch(
            close_url,
            {"status": Complaint.Status.CLOSED},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        history_count_after_close = ComplaintStatusHistory.objects.filter(complaint=complaint).count()
        close_audit_count_after_close = AuditEvent.objects.filter(
            complaint=complaint, action="COMPLAINT_CLOSED",
        ).count()
        transition_complaint(
            complaint=stale_resolved_complaint,
            actor=self.electrical_admin,
            new_status=Complaint.Status.CLOSED,
        )

        complaint.refresh_from_db()

        # Verify final status.
        self.assertEqual(complaint.status, Complaint.Status.CLOSED)

        # Verify status history.
        history = ComplaintStatusHistory.objects.filter(
            complaint=complaint
        ).order_by("created_at")

        self.assertEqual(history.count(), 7)
        self.assertEqual(ComplaintStatusHistory.objects.filter(complaint=complaint).count(), history_count_after_close)
        self.assertEqual(
            AuditEvent.objects.filter(complaint=complaint, action="COMPLAINT_CLOSED").count(),
            close_audit_count_after_close,
        )

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

    def test_super_admin_cannot_advance_submitted_complaint_without_assignment(self):
        complaint = create_complaint(
            actor=self.user,
            title="Unassigned socket",
            description="Socket needs inspection",
            category="Electrical",
        )
        super_admin = User.objects.create_superuser(
            "workflow-super-admin@example.com", name="Workflow Super Admin", password=PASSWORD,
        )
        client = APIClient()
        client.force_authenticate(super_admin)
        before_history = complaint.status_history.count()
        before_audits = AuditEvent.objects.filter(complaint=complaint).count()

        response = client.patch(
            f"/api/admin/complaints/{complaint.pk}/status",
            {"status": Complaint.Status.IN_PROGRESS},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)

        complaint.refresh_from_db()
        self.assertEqual(complaint.status, Complaint.Status.SUBMITTED)
        self.assertFalse(WorkAssignment.objects.filter(complaint=complaint, is_current=True).exists())
        self.assertEqual(complaint.status_history.count(), before_history)
        self.assertEqual(AuditEvent.objects.filter(complaint=complaint).count(), before_audits)

    def test_department_admin_cannot_save_resolution_before_work_completion(self):
        complaint = create_complaint(
            actor=self.user,
            title="Unstarted repair",
            description="The repair has not been assigned or started.",
            category="Electrical",
        )
        client = APIClient()
        client.force_authenticate(self.electrical_admin)
        before_audits = AuditEvent.objects.filter(complaint=complaint).count()

        response = client.patch(
            f"/api/admin/complaints/{complaint.pk}/resolution",
            {"resolution": "Repair completed"},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        complaint.refresh_from_db()
        self.assertEqual(complaint.status, Complaint.Status.SUBMITTED)
        self.assertEqual(complaint.resolution, "")
        self.assertFalse(AuditEvent.objects.filter(complaint=complaint, action__startswith="RESOLUTION_").exists())
        self.assertEqual(AuditEvent.objects.filter(complaint=complaint).count(), before_audits)


class ComplaintSerializerTests(TestCase):
    def setUp(self):
        self.department = Department.objects.create(identifier="serializer-electrical", name="Electrical")
        self.inactive_department = Department.objects.create(
            identifier="serializer-inactive", name="Inactive", is_active=False,
        )
        self.owner = User.objects.create_user("serializer-owner@example.com", name="Owner", password=PASSWORD)
        self.employee = User.objects.create_user(
            "serializer-employee@example.com", name="Employee", password=PASSWORD, role=UserRole.EMPLOYEE,
        )
        self.mapping = CategoryDepartmentMapping.objects.create(
            category="Serializer Electrical", department=self.department,
        )
        self.complaint = create_complaint(
            actor=self.owner, title="Outlet issue", description="A socket is loose", category="Serializer Electrical",
        )

    def test_create_serializer_required_values_null_empty_trim_and_save(self):
        self.assertFalse(ComplaintCreateSerializer(data={}).is_valid())
        for field in ("title", "description", "category"):
            with self.subTest(field=field, value=None):
                self.assertFalse(ComplaintCreateSerializer(data={field: None}).is_valid())
            with self.subTest(field=field, value="blank"):
                self.assertFalse(ComplaintCreateSerializer(data={field: "   "}).is_valid())

        serializer = ComplaintCreateSerializer(
            data={"title": "  New issue  ", "description": "  Needs review  ", "category": "  Other  "},
            context={"request": SimpleNamespace(user=self.owner)},
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        created = serializer.save()
        self.assertEqual((created.title, created.description, created.category), ("New issue", "Needs review", "Other"))
        self.assertEqual(created.submitted_by, self.owner)

    def test_update_serializer_optional_fields_and_rejects_null_or_blank_values(self):
        serializer = ComplaintUpdateSerializer(
            instance=self.complaint,
            data={"description": "  Updated description  "},
            context={"request": SimpleNamespace(user=self.owner)},
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        updated = serializer.save()
        self.assertEqual(updated.description, "Updated description")
        self.assertEqual(updated.title, "Outlet issue")
        self.assertEqual(updated.category, "Serializer Electrical")

        self.assertTrue(ComplaintUpdateSerializer(instance=updated, data={}).is_valid())
        for value in (None, "   "):
            with self.subTest(value=value):
                invalid = ComplaintUpdateSerializer(instance=updated, data={"title": value})
                self.assertFalse(invalid.is_valid())

    def test_status_resolution_reopen_priority_and_reassignment_validation(self):
        valid_status = StatusChangeSerializer(data={"status": Complaint.Status.ACCEPTED, "note": ""})
        self.assertTrue(valid_status.is_valid(), valid_status.errors)
        self.assertEqual(valid_status.validated_data["note"], "")
        self.assertFalse(StatusChangeSerializer(data={}).is_valid())
        self.assertFalse(StatusChangeSerializer(data={"status": "Unknown"}).is_valid())
        self.assertFalse(StatusChangeSerializer(data={"status": Complaint.Status.ACCEPTED, "note": None}).is_valid())

        resolution = ResolutionSerializer(data={"resolution": "  Repaired  "})
        self.assertTrue(resolution.is_valid(), resolution.errors)
        self.assertEqual(resolution.validated_data["resolution"], "Repaired")
        for value in (None, "", "   "):
            with self.subTest(serializer="resolution", value=value):
                self.assertFalse(ResolutionSerializer(data={"resolution": value}).is_valid())

        reopen = ReopenSerializer(data={"reason": "  Fresh assignment required  "})
        self.assertTrue(reopen.is_valid(), reopen.errors)
        self.assertEqual(reopen.validated_data["reason"], "Fresh assignment required")
        for value in (None, "", "   "):
            with self.subTest(serializer="reopen", value=value):
                self.assertFalse(ReopenSerializer(data={"reason": value}).is_valid())

        priority = PriorityOverrideSerializer(data={"priority": Complaint.Priority.HIGH, "reason": "  Review  "})
        self.assertTrue(priority.is_valid(), priority.errors)
        self.assertEqual(priority.validated_data["reason"], "Review")
        self.assertFalse(PriorityOverrideSerializer(data={"priority": "URGENT", "reason": "Reason"}).is_valid())
        self.assertFalse(PriorityOverrideSerializer(data={"priority": Complaint.Priority.LOW, "reason": " "}).is_valid())

        reassignment = DepartmentReassignmentSerializer(
            data={"department_id": self.department.pk, "reason": "  Routing correction  "},
        )
        self.assertTrue(reassignment.is_valid(), reassignment.errors)
        self.assertEqual(reassignment.validated_data["department"], self.department)
        self.assertEqual(reassignment.validated_data["reason"], "Routing correction")
        self.assertFalse(DepartmentReassignmentSerializer(data={"department_id": None, "reason": "why"}).is_valid())
        self.assertFalse(DepartmentReassignmentSerializer(data={"department_id": self.inactive_department.pk, "reason": "why"}).is_valid())
        self.assertFalse(DepartmentReassignmentSerializer(data={"department_id": self.department.pk, "reason": " "}).is_valid())

    def test_attachment_validation_and_url_serialization_with_and_without_request(self):
        valid_file = SimpleUploadedFile("proof.PDF", b"valid evidence")
        valid = ComplaintAttachmentCreateSerializer(data={"file": valid_file})
        self.assertTrue(valid.is_valid(), valid.errors)
        self.assertIs(valid.validated_data["file"], valid_file)
        self.assertFalse(ComplaintAttachmentCreateSerializer(data={}).is_valid())
        self.assertFalse(ComplaintAttachmentCreateSerializer(data={"file": None}).is_valid())
        self.assertFalse(
            ComplaintAttachmentCreateSerializer(data={"file": SimpleUploadedFile("proof.exe", b"x")}).is_valid()
        )
        oversized = SimpleUploadedFile("large.pdf", b"x" * (10 * 1024 * 1024 + 1))
        self.assertFalse(ComplaintAttachmentCreateSerializer(data={"file": oversized}).is_valid())
        empty_file = SimpleUploadedFile("empty.pdf", b"")
        self.assertFalse(ComplaintAttachmentCreateSerializer(data={"file": empty_file}).is_valid())

        attachment = ComplaintAttachment.objects.create(
            complaint=self.complaint,
            uploaded_by=self.employee,
            file="complaints/2026/11/proof.pdf",
            original_name="proof.pdf",
            content_type="application/pdf",
            size_bytes=12,
        )
        relative = AttachmentSerializer(attachment).data
        self.assertEqual(relative["url"], "/media/complaints/2026/11/proof.pdf")
        self.assertEqual(relative["uploadedBy"]["email"], self.employee.email)
        request = APIRequestFactory().get("/", secure=True)
        absolute = AttachmentSerializer(attachment, context={"request": request}).data
        self.assertEqual(absolute["url"], "https://testserver/media/complaints/2026/11/proof.pdf")

    def test_mapping_serializer_normalizes_category_checks_duplicates_and_serializes_null_department(self):
        duplicate = CategoryDepartmentMappingSerializer(
            data={"category": "  sErIaLiZeR eLeCtRiCaL  ", "department_id": None},
        )
        self.assertFalse(duplicate.is_valid())
        self.assertIn("category", duplicate.errors)

        update_self = CategoryDepartmentMappingSerializer(
            instance=self.mapping, data={"category": "  SERIALIZER ELECTRICAL  "}, partial=True,
        )
        self.assertTrue(update_self.is_valid(), update_self.errors)
        self.assertEqual(update_self.validated_data["category"], "SERIALIZER ELECTRICAL")

        create = CategoryDepartmentMappingSerializer(data={"category": "  Network   Services  "})
        self.assertTrue(create.is_valid(), create.errors)
        mapping = create.save()
        self.assertEqual(mapping.category, "Network Services")
        serialized = CategoryDepartmentMappingSerializer(mapping).data
        self.assertEqual(serialized["department_id"], None)
        self.assertIsNone(serialized["department_name"])
        self.assertNotIn("created_at", serialized)

        null_department = CategoryDepartmentMappingSerializer(
            data={"category": "Unassigned", "department_id": None},
        )
        self.assertTrue(null_department.is_valid(), null_department.errors)
        invalid_department = CategoryDepartmentMappingSerializer(
            data={"category": "Inactive mapping", "department_id": self.inactive_department.pk},
        )
        self.assertFalse(invalid_department.is_valid())

    def test_complaint_read_serializer_nested_related_fields_and_null_department(self):
        self.complaint.department = None
        self.complaint.save(update_fields=["department"])
        unassigned_data = ComplaintReadSerializer(self.complaint).data
        self.assertIsNone(unassigned_data["assignedDepartment"])
        self.assertIsNone(unassigned_data["assignedEmployee"])
        self.assertEqual(unassigned_data["submittedBy"]["id"], self.owner.pk)
        self.assertEqual(unassigned_data["status"], Complaint.Status.SUBMITTED)
        self.assertIn("priorityScore", unassigned_data)
        self.assertIn("priorityReason", unassigned_data)
        self.assertNotIn("password", unassigned_data["submittedBy"])

        self.complaint.department = self.department
        self.complaint.assigned_employee = self.employee
        self.complaint.status = Complaint.Status.WORK_COMPLETED
        self.complaint.priority = Complaint.Priority.HIGH
        self.complaint.priority_score = 62
        self.complaint.priority_reason = ["Service disruption detected: power outage."]
        self.complaint.priority_overridden = True
        self.complaint.resolution = "Repair completed"
        self.complaint.save()
        history = ComplaintStatusHistory.objects.create(
            complaint=self.complaint,
            actor=self.employee,
            actor_role=UserRole.EMPLOYEE,
            previous_status=Complaint.Status.IN_PROGRESS,
            new_status=Complaint.Status.WORK_COMPLETED,
            note="Completed repair",
            metadata={"evidence_count": 1},
        )
        attachment = ComplaintAttachment.objects.create(
            complaint=self.complaint,
            uploaded_by=self.employee,
            file="complaints/2026/11/work-proof.jpg",
            original_name="work-proof.jpg",
            content_type="image/jpeg",
            size_bytes=8,
        )

        data = ComplaintReadSerializer(self.complaint).data
        self.assertEqual(data["assignedDepartment"], {
            "id": self.department.pk,
            "identifier": self.department.identifier,
            "name": self.department.name,
        })
        self.assertEqual(data["assignedEmployee"]["id"], self.employee.pk)
        self.assertEqual(data["status"], Complaint.Status.WORK_COMPLETED)
        self.assertEqual(data["priority"], Complaint.Priority.HIGH)
        self.assertEqual(data["priorityScore"], 62)
        self.assertTrue(data["priority_overridden"])
        self.assertEqual(data["resolution"], "Repair completed")
        self.assertEqual(data["statusHistory"][-1]["id"], history.pk)
        self.assertEqual(data["statusHistory"][-1]["actor"]["email"], self.employee.email)
        self.assertEqual(data["statusHistory"][-1]["metadata"], {"evidence_count": 1})
        self.assertEqual(data["attachments"][0]["id"], attachment.pk)
        self.assertEqual(data["attachments"][0]["uploadedBy"]["id"], self.employee.pk)

    def test_priority_policy_partial_validation_keywords_read_only_and_model_error_translation(self):
        policy = PriorityPolicy.objects.get(pk=1)
        valid = PriorityPolicySerializer(
            instance=policy,
            data={"safety_weight": 35, "urgency_weight": 25, "safety_keywords": ["  exposed wire  "]},
            partial=True,
        )
        self.assertTrue(valid.is_valid(), valid.errors)
        self.assertEqual(valid.validated_data["safety_keywords"], ["  exposed wire  "])
        saved = valid.save()
        self.assertEqual(saved.safety_weight, 35)
        self.assertEqual(saved.urgency_weight, 25)
        self.assertNotIn("updated_at", valid.validated_data)
        self.assertIn("updated_at", valid.data)

        invalid_weights = PriorityPolicySerializer(
            instance=saved, data={"safety_weight": 41}, partial=True,
        )
        self.assertFalse(invalid_weights.is_valid())
        invalid_thresholds = PriorityPolicySerializer(
            instance=saved, data={"medium_threshold": saved.high_threshold}, partial=True,
        )
        self.assertFalse(invalid_thresholds.is_valid())
        for value in ("single keyword", ["valid", 2], None):
            with self.subTest(keywords=value):
                invalid_keywords = PriorityPolicySerializer(
                    instance=saved, data={"disruption_keywords": value}, partial=True,
                )
                self.assertFalse(invalid_keywords.is_valid())

        model_error = PriorityPolicySerializer(
            instance=saved, data={"safety_keywords": ["candidate"]}, partial=True,
        )
        self.assertTrue(model_error.is_valid(), model_error.errors)
        with self.assertRaises(DRFValidationError):
            model_error.save(urgency_weight=saved.urgency_weight + 1)
        saved.refresh_from_db()
        self.assertEqual(saved.urgency_weight, 25)


class ComplaintServiceTests(TestCase):
    def setUp(self):
        self.electrical = Department.objects.create(identifier="service-electrical", name="Service Electrical")
        self.plumbing = Department.objects.create(identifier="service-plumbing", name="Service Plumbing")
        self.inactive_department = Department.objects.create(
            identifier="service-inactive", name="Service Inactive", is_active=False,
        )
        CategoryDepartmentMapping.objects.create(category="Service Electrical", department=self.electrical)
        CategoryDepartmentMapping.objects.create(category="Service Electrical Annex", department=self.electrical)
        CategoryDepartmentMapping.objects.create(category="Service Plumbing", department=self.plumbing)
        CategoryDepartmentMapping.objects.create(
            category="Service Disabled", department=self.inactive_department, is_active=False,
        )
        self.owner = User.objects.create_user("service-owner@example.com", name="Owner", password=PASSWORD)
        self.super_admin = User.objects.create_superuser(
            "service-super@example.com", name="Super Admin", password=PASSWORD,
        )
        self.electrical_admin = User.objects.create_user(
            "service-electrical-admin@example.com", name="Electrical Admin", password=PASSWORD,
            role=UserRole.DEPARTMENT_ADMIN,
        )
        DepartmentAdminProfile.objects.create(user=self.electrical_admin, department=self.electrical)
        self.plumbing_admin = User.objects.create_user(
            "service-plumbing-admin@example.com", name="Plumbing Admin", password=PASSWORD,
            role=UserRole.DEPARTMENT_ADMIN,
        )
        DepartmentAdminProfile.objects.create(user=self.plumbing_admin, department=self.plumbing)
        self.profileless_admin = User.objects.create_user(
            "service-profileless-admin@example.com", name="Profileless Admin", password=PASSWORD,
            role=UserRole.DEPARTMENT_ADMIN,
        )
        self.employee = User.objects.create_user(
            "service-employee@example.com", name="Employee", password=PASSWORD, role=UserRole.EMPLOYEE,
        )
        EmployeeProfile.objects.create(user=self.employee, department=self.electrical, job_title="Technician")

    def _complaint(self, *, category="Service Electrical", title="Fixture repair", description="A fixture is loose"):
        return create_complaint(actor=self.owner, title=title, description=description, category=category)

    def _assignment(self, complaint, status, *, is_current=True):
        return WorkAssignment.objects.create(
            complaint=complaint,
            employee=self.employee,
            assigned_by=self.electrical_admin,
            status=status,
            is_current=is_current,
        )

    def test_create_routes_unassigned_and_disabled_categories_and_rolls_back_failures(self):
        routed = self._complaint()
        self.assertEqual(routed.department, self.electrical)
        self.assertEqual(routed.category_mapping.category, "Service Electrical")
        self.assertEqual(routed.status, Complaint.Status.SUBMITTED)
        self.assertIsNotNone(routed.due_at)
        first_history = routed.status_history.get()
        self.assertEqual(first_history.new_status, Complaint.Status.SUBMITTED)
        self.assertEqual(first_history.actor, self.owner)
        self.assertTrue(AuditEvent.objects.filter(complaint=routed, action="COMPLAINT_CREATED").exists())
        self.assertTrue(Notification.objects.filter(complaint=routed, recipient=self.electrical_admin).exists())

        unassigned = self._complaint(category="Service Review Queue")
        self.assertIsNone(unassigned.department)
        self.assertTrue(Notification.objects.filter(
            complaint=unassigned, recipient=self.super_admin, kind="UNASSIGNED_REVIEW",
        ).exists())

        before_count = Complaint.objects.count()
        with self.assertRaises(ValidationError):
            self._complaint(category="Service Disabled")
        self.assertEqual(Complaint.objects.count(), before_count)

        history_count = ComplaintStatusHistory.objects.count()
        audit_count = AuditEvent.objects.count()
        notification_count = Notification.objects.count()
        with patch("complaints.services.log_event", side_effect=RuntimeError("audit unavailable")):
            with self.assertRaisesRegex(RuntimeError, "audit unavailable"):
                self._complaint(category="Service Electrical Annex")
        self.assertEqual(Complaint.objects.count(), before_count)
        self.assertEqual(ComplaintStatusHistory.objects.count(), history_count)
        self.assertEqual(AuditEvent.objects.count(), audit_count)
        self.assertEqual(Notification.objects.count(), notification_count)

    def test_update_enforces_owner_stage_and_handles_department_routing(self):
        complaint = self._complaint()
        before_noop_audits = AuditEvent.objects.filter(complaint=complaint).count()
        unchanged = update_complaint(complaint=complaint, actor=self.owner, changes={})
        self.assertEqual(unchanged.title, "Fixture repair")
        self.assertEqual(AuditEvent.objects.filter(complaint=unchanged).count(), before_noop_audits)

        updated = update_complaint(
            complaint=complaint,
            actor=self.owner,
            changes={"title": "  Urgent entire floor water outage  ", "category": "Service Plumbing"},
        )
        self.assertEqual(updated.title, "Urgent entire floor water outage")
        self.assertEqual(updated.department, self.plumbing)
        self.assertEqual(updated.priority, Complaint.Priority.HIGH)
        self.assertTrue(AuditEvent.objects.filter(complaint=updated, action="COMPLAINT_UPDATED").exists())
        self.assertTrue(AuditEvent.objects.filter(complaint=updated, action="PRIORITY_CHANGED").exists())
        department_event = AuditEvent.objects.get(complaint=updated, action="DEPARTMENT_REASSIGNED")
        self.assertEqual(department_event.previous_value["department_id"], self.electrical.pk)
        self.assertEqual(department_event.new_value["department_id"], self.plumbing.pk)
        self.assertTrue(Notification.objects.filter(
            complaint=updated, recipient=self.plumbing_admin, kind="DEPARTMENT_ROUTED",
        ).exists())

        same_department_complaint = self._complaint()
        same_department = update_complaint(
            complaint=same_department_complaint,
            actor=self.owner,
            changes={"category": "Service Electrical Annex"},
        )
        self.assertEqual(same_department.department, self.electrical)
        self.assertFalse(AuditEvent.objects.filter(
            complaint=same_department, action="DEPARTMENT_REASSIGNED",
        ).exists())

        same_department = update_complaint(
            complaint=updated, actor=self.owner, changes={"category": "Service Electrical Annex"},
        )
        self.assertEqual(same_department.department, self.electrical)
        self.assertTrue(AuditEvent.objects.filter(complaint=same_department, action="DEPARTMENT_REASSIGNED").exists())

        unassigned = update_complaint(
            complaint=same_department, actor=self.owner, changes={"category": "Service Review Queue"},
        )
        self.assertIsNone(unassigned.department)
        self.assertTrue(Notification.objects.filter(
            complaint=unassigned, recipient=self.super_admin, kind="UNASSIGNED_REVIEW",
        ).exists())

        unassigned.refresh_from_db()
        prior_category = unassigned.category
        with self.assertRaises(ValidationError):
            update_complaint(complaint=unassigned, actor=self.owner, changes={"category": "Service Disabled"})
        unassigned.refresh_from_db()
        self.assertEqual(unassigned.category, prior_category)

        unassigned.status = Complaint.Status.ASSIGNED
        unassigned.save(update_fields=["status"])
        with self.assertRaises(ValidationError):
            update_complaint(complaint=unassigned, actor=self.owner, changes={"title": "Forbidden edit"})
        unassigned.refresh_from_db()
        self.assertNotEqual(unassigned.title, "Forbidden edit")

    def test_update_rolls_back_saved_fields_when_audit_creation_fails(self):
        complaint = self._complaint()
        old_title = complaint.title
        history_count = complaint.status_history.count()
        audit_count = AuditEvent.objects.filter(complaint=complaint).count()
        with patch("complaints.services.log_event", side_effect=RuntimeError("audit unavailable")):
            with self.assertRaisesRegex(RuntimeError, "audit unavailable"):
                update_complaint(complaint=complaint, actor=self.owner, changes={"title": "Changed title"})
        complaint.refresh_from_db()
        self.assertEqual(complaint.title, old_title)
        self.assertEqual(complaint.status_history.count(), history_count)
        self.assertEqual(AuditEvent.objects.filter(complaint=complaint).count(), audit_count)

    def test_priority_overrides_cover_safety_rules_idempotence_and_audit(self):
        ordinary = self._complaint()
        same = override_priority(
            complaint=ordinary, actor=self.electrical_admin, priority=ordinary.priority, reason="",
        )
        self.assertEqual(same.priority, Complaint.Priority.LOW)
        self.assertFalse(AuditEvent.objects.filter(complaint=ordinary, action="PRIORITY_OVERRIDDEN").exists())

        with self.assertRaises(ValidationError):
            override_priority(
                complaint=ordinary, actor=self.electrical_admin, priority=Complaint.Priority.HIGH, reason=" ",
            )
        self.assertFalse(ordinary.priority_overridden)

        upgraded = override_priority(
            complaint=ordinary, actor=self.electrical_admin, priority=Complaint.Priority.HIGH, reason="  Escalate  ",
        )
        self.assertEqual(upgraded.priority, Complaint.Priority.HIGH)
        self.assertTrue(upgraded.priority_overridden)
        self.assertEqual(upgraded.priority_reason[-1], "Administrator override: Escalate")
        event = AuditEvent.objects.get(complaint=upgraded, action="PRIORITY_OVERRIDDEN")
        self.assertEqual(event.metadata["reason"], "Escalate")
        self.assertFalse(event.metadata["safety_triggered"])

        safety = self._complaint(title="Dangerous condition", description="Dangerous and urgent condition")
        self.assertEqual(safety.priority, Complaint.Priority.CRITICAL)
        with self.assertRaises(ValidationError):
            override_priority(
                complaint=safety, actor=self.electrical_admin, priority=Complaint.Priority.LOW, reason="Downgrade",
            )
        safety.refresh_from_db()
        self.assertEqual(safety.priority, Complaint.Priority.CRITICAL)

        downgraded = override_priority(
            complaint=safety, actor=self.super_admin, priority=Complaint.Priority.HIGH, reason="  Reviewed  ",
        )
        self.assertEqual(downgraded.priority, Complaint.Priority.HIGH)
        safety_event = AuditEvent.objects.get(complaint=safety, action="PRIORITY_OVERRIDDEN")
        self.assertTrue(safety_event.metadata["safety_triggered"])
        self.assertEqual(safety_event.metadata["reason"], "Reviewed")

    def test_transition_validation_history_idempotence_and_transaction_rollback(self):
        complaint = self._complaint()
        initial_history = complaint.status_history.count()
        initial_audits = AuditEvent.objects.filter(complaint=complaint).count()
        with self.assertRaises(ValidationError):
            transition_complaint(complaint=complaint, actor=self.electrical_admin, new_status=Complaint.Status.ACCEPTED)
        with self.assertRaises(ValidationError):
            transition_complaint(complaint=complaint, actor=self.electrical_admin, new_status=Complaint.Status.ASSIGNED)
        complaint.refresh_from_db()
        self.assertEqual(complaint.status, Complaint.Status.SUBMITTED)
        self.assertEqual(complaint.status_history.count(), initial_history)
        self.assertEqual(AuditEvent.objects.filter(complaint=complaint).count(), initial_audits)

        assignment = self._assignment(complaint, WorkAssignment.Status.ASSIGNED)
        assigned = transition_complaint(
            complaint=complaint,
            actor=self.electrical_admin,
            new_status=Complaint.Status.ASSIGNED,
            note="Assigned",
            metadata={"cycle": 1},
        )
        history = assigned.status_history.latest("id")
        self.assertEqual(history.note, "Assigned")
        self.assertEqual(history.metadata, {"cycle": 1})
        count_after_transition = assigned.status_history.count()
        audits_after_transition = AuditEvent.objects.filter(complaint=assigned).count()
        idempotent = transition_complaint(
            complaint=assigned, actor=self.electrical_admin, new_status=Complaint.Status.ASSIGNED,
        )
        self.assertEqual(idempotent.status_history.count(), count_after_transition)
        self.assertEqual(AuditEvent.objects.filter(complaint=assigned).count(), audits_after_transition)

        assignment.status = WorkAssignment.Status.ACCEPTED
        assignment.save(update_fields=["status"])
        accepted = transition_complaint(
            complaint=assigned, actor=self.employee, new_status=Complaint.Status.ACCEPTED,
        )
        self.assertEqual(accepted.status, Complaint.Status.ACCEPTED)

        accepted.status = Complaint.Status.RESOLVED
        accepted.resolution = ""
        accepted.save(update_fields=["status", "resolution"])
        assignment.status = WorkAssignment.Status.VERIFIED
        assignment.save(update_fields=["status"])
        before_history = accepted.status_history.count()
        before_audits = AuditEvent.objects.filter(complaint=accepted).count()
        with self.assertRaises(ValidationError):
            transition_complaint(
                complaint=accepted,
                actor=self.electrical_admin,
                new_status=Complaint.Status.CLOSED,
            )
        accepted.refresh_from_db()
        self.assertEqual(accepted.status, Complaint.Status.RESOLVED)
        self.assertEqual(accepted.status_history.count(), before_history)
        self.assertEqual(AuditEvent.objects.filter(complaint=accepted).count(), before_audits)

        accepted.resolution = "Verified repair"
        accepted.save(update_fields=["resolution"])
        with patch("complaints.services.log_event", side_effect=RuntimeError("audit unavailable")):
            with self.assertRaisesRegex(RuntimeError, "audit unavailable"):
                transition_complaint(
                    complaint=accepted,
                    actor=self.electrical_admin,
                    new_status=Complaint.Status.CLOSED,
                )
        accepted.refresh_from_db()
        self.assertEqual(accepted.status, Complaint.Status.RESOLVED)
        self.assertEqual(accepted.status_history.count(), before_history)
        self.assertEqual(AuditEvent.objects.filter(complaint=accepted).count(), before_audits)
        self.assertFalse(Notification.objects.filter(complaint=accepted, kind="CLOSED").exists())

        with self.assertRaises(Complaint.DoesNotExist):
            transition_complaint(
                complaint=SimpleNamespace(pk=-1), actor=self.electrical_admin,
                new_status=Complaint.Status.ASSIGNED,
            )

    def test_resolution_permissions_stage_updates_and_rollback(self):
        complaint = self._complaint()
        with self.assertRaises(ValidationError):
            save_resolution(complaint=complaint, actor=self.owner, resolution="Done")
        with self.assertRaises(ValidationError):
            save_resolution(complaint=complaint, actor=self.plumbing_admin, resolution="Done")
        with self.assertRaises(ValidationError):
            save_resolution(complaint=complaint, actor=self.profileless_admin, resolution="Done")
        with self.assertRaises(ValidationError):
            save_resolution(complaint=complaint, actor=self.electrical_admin, resolution="Done")

        complaint.status = Complaint.Status.WORK_COMPLETED
        complaint.save(update_fields=["status"])
        assignment = self._assignment(complaint, WorkAssignment.Status.COMPLETED)
        with self.assertRaises(ValidationError):
            save_resolution(complaint=complaint, actor=self.electrical_admin, resolution="   ")

        saved = save_resolution(complaint=complaint, actor=self.electrical_admin, resolution="  First repair  ")
        self.assertEqual(saved.resolution, "First repair")
        self.assertTrue(AuditEvent.objects.filter(complaint=saved, action="RESOLUTION_ADDED").exists())
        updated = save_resolution(complaint=saved, actor=self.electrical_admin, resolution="Final repair")
        self.assertEqual(updated.resolution, "Final repair")
        update_event = AuditEvent.objects.get(complaint=updated, action="RESOLUTION_UPDATED")
        self.assertEqual(update_event.previous_value["resolution"], "First repair")

        before_audits = AuditEvent.objects.filter(complaint=updated).count()
        with patch("complaints.services.log_event", side_effect=RuntimeError("audit unavailable")):
            with self.assertRaisesRegex(RuntimeError, "audit unavailable"):
                save_resolution(complaint=updated, actor=self.electrical_admin, resolution="Uncommitted value")
        updated.refresh_from_db()
        self.assertEqual(updated.resolution, "Final repair")
        self.assertEqual(AuditEvent.objects.filter(complaint=updated).count(), before_audits)
        self.assertTrue(WorkAssignment.objects.filter(pk=assignment.pk, is_current=True).exists())

    def test_reopen_permissions_current_assignment_reset_and_transaction_rollback(self):
        complaint = self._complaint()
        complaint.status = Complaint.Status.CLOSED
        complaint.resolution = "Original resolution"
        complaint.resolved_at = timezone.now()
        complaint.closed_at = timezone.now()
        complaint.assigned_employee = self.employee
        complaint.save()
        assignment = self._assignment(complaint, WorkAssignment.Status.VERIFIED)

        with self.assertRaises(ValidationError):
            reopen_complaint(complaint=complaint, actor=self.electrical_admin, reason="No")
        nonclosed = self._complaint()
        with self.assertRaises(ValidationError):
            reopen_complaint(complaint=nonclosed, actor=self.super_admin, reason="No")

        reopened = reopen_complaint(complaint=complaint, actor=self.super_admin, reason="  New cycle  ")
        self.assertEqual(reopened.status, Complaint.Status.SUBMITTED)
        self.assertEqual(reopened.resolution, "")
        self.assertIsNone(reopened.resolved_at)
        self.assertIsNone(reopened.closed_at)
        self.assertIsNone(reopened.assigned_employee_id)
        assignment.refresh_from_db()
        self.assertEqual(assignment.status, WorkAssignment.Status.CANCELED)
        self.assertFalse(assignment.is_current)
        history = reopened.status_history.latest("id")
        self.assertEqual(history.metadata["previous_resolution"], "Original resolution")
        self.assertEqual(history.metadata["previous_assignment"]["id"], assignment.pk)
        self.assertEqual(history.note, "New cycle")
        event = AuditEvent.objects.get(complaint=reopened, action="COMPLAINT_REOPENED")
        self.assertEqual(event.metadata["reason"], "New cycle")

        no_assignment = self._complaint()
        no_assignment.status = Complaint.Status.CLOSED
        no_assignment.save(update_fields=["status"])
        reopened_without_assignment = reopen_complaint(
            complaint=no_assignment, actor=self.super_admin, reason="No current assignment",
        )
        self.assertEqual(reopened_without_assignment.status, Complaint.Status.SUBMITTED)
        self.assertIsNone(reopened_without_assignment.status_history.latest("id").metadata["previous_assignment"])

        rollback = self._complaint()
        rollback.status = Complaint.Status.CLOSED
        rollback.resolution = "Keep this resolution"
        rollback.save(update_fields=["status", "resolution"])
        rollback_assignment = self._assignment(rollback, WorkAssignment.Status.VERIFIED)
        with patch("complaints.services.log_event", side_effect=RuntimeError("audit unavailable")):
            with self.assertRaisesRegex(RuntimeError, "audit unavailable"):
                reopen_complaint(complaint=rollback, actor=self.super_admin, reason="Rollback me")
        rollback.refresh_from_db()
        rollback_assignment.refresh_from_db()
        self.assertEqual(rollback.status, Complaint.Status.CLOSED)
        self.assertEqual(rollback.resolution, "Keep this resolution")
        self.assertEqual(rollback_assignment.status, WorkAssignment.Status.VERIFIED)
        self.assertTrue(rollback_assignment.is_current)

    def test_actor_manager_scope_for_all_role_cases(self):
        electrical_complaint = self._complaint()
        plumbing_complaint = self._complaint(category="Service Plumbing")
        self.assertTrue(actor_can_manage_complaint(self.super_admin, plumbing_complaint))
        self.assertTrue(actor_can_manage_complaint(self.electrical_admin, electrical_complaint))
        self.assertFalse(actor_can_manage_complaint(self.electrical_admin, plumbing_complaint))
        self.assertFalse(actor_can_manage_complaint(self.profileless_admin, electrical_complaint))
        self.assertFalse(actor_can_manage_complaint(self.owner, electrical_complaint))
