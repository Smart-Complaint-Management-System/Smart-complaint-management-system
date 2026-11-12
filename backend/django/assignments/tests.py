import os
from tempfile import TemporaryDirectory
from django.test import TestCase
from django.test import override_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient
from unittest.mock import patch

from accounts.models import DepartmentAdminProfile, EmployeeProfile, User
from accounts.roles import UserRole
from assignments.models import WorkAssignment, WorkEvidence
from assignments.services import (
    accept_assignment,
    assign_complaint,
    complete_assignment,
    create_work_evidence,
    update_assignment_progress,
    verify_assignment,
)
from audit.models import AuditEvent
from complaints.models import Complaint, ComplaintStatusHistory
from complaints.services import create_complaint
from assignments.services import reassign_complaint_department
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

    def _complete_and_close_cycle(self, employee, resolution):
        assignment = assign_complaint(complaint=self.complaint, actor=self.admin, employee=employee)
        accept_assignment(assignment=assignment, actor=employee)
        update_assignment_progress(
            assignment=assignment, actor=employee, note="Started repair.", progress_percent=40,
        )
        assignment = complete_assignment(assignment=assignment, actor=employee, note="Repair completed.")
        assignment = verify_assignment(assignment=assignment, actor=self.admin, resolution=resolution)
        client = APIClient()
        client.force_authenticate(self.admin)
        response = client.patch(
            f"/api/admin/complaints/{self.complaint.pk}/status",
            {"status": Complaint.Status.CLOSED},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.complaint.refresh_from_db()
        self.assertEqual(self.complaint.status, Complaint.Status.CLOSED)
        self.assertEqual(self.complaint.resolution, resolution)
        return assignment

    def _reopen_as_super_admin(self, reason="Reopen for another repair cycle."):
        super_admin = User.objects.create_superuser(
            "reopen-super-admin@example.com", name="Reopen Super Admin", password=PASSWORD,
        )
        client = APIClient()
        client.force_authenticate(super_admin)
        response = client.post(
            f"/api/admin/complaints/{self.complaint.pk}/reopen",
            {"reason": reason},
            format="json",
        )
        return super_admin, client, response

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
        update_assignment_progress(
            assignment=assignment, actor=self.worker, note="Started the repair.", progress_percent=25,
        )
        completed = complete_assignment(assignment=assignment, actor=self.worker, note="Replaced damaged socket.")
        self.assertEqual(completed.status, WorkAssignment.Status.COMPLETED)
        verified = verify_assignment(assignment=completed, actor=self.admin, resolution="Socket replaced and tested.")
        self.assertEqual(verified.status, WorkAssignment.Status.VERIFIED)
        self.complaint.refresh_from_db()
        self.assertEqual(self.complaint.status, Complaint.Status.RESOLVED)
        actions = set(AuditEvent.objects.filter(complaint=self.complaint).values_list("action", flat=True))
        self.assertTrue({"EMPLOYEE_ASSIGNED", "ASSIGNMENT_ACCEPTED", "WORK_COMPLETED", "WORK_VERIFIED", "RESOLUTION_ADDED"}.issubset(actions))
        self.assertTrue(Notification.objects.filter(recipient=self.worker).exists())

        client = APIClient()
        client.force_authenticate(self.admin)
        response = client.patch(
            f"/api/admin/complaints/{self.complaint.pk}/status",
            {"status": Complaint.Status.CLOSED},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.complaint.refresh_from_db()
        self.assertEqual(self.complaint.status, Complaint.Status.CLOSED)
        self.assertTrue(
            AuditEvent.objects.filter(complaint=self.complaint, action="COMPLAINT_CLOSED").exists()
        )

    def test_employee_cannot_complete_accepted_assignment_without_progress(self):
        assignment = assign_complaint(complaint=self.complaint, actor=self.admin, employee=self.worker)
        accept_assignment(assignment=assignment, actor=self.worker)
        before_audits = AuditEvent.objects.filter(complaint=self.complaint).count()

        with self.assertRaises(ValidationError):
            complete_assignment(assignment=assignment, actor=self.worker, note="Attempted early completion.")

        assignment.refresh_from_db()
        self.complaint.refresh_from_db()
        self.assertEqual(assignment.status, WorkAssignment.Status.ACCEPTED)
        self.assertEqual(self.complaint.status, Complaint.Status.ACCEPTED)
        self.assertFalse(AuditEvent.objects.filter(complaint=self.complaint, action="WORK_COMPLETED").exists())
        self.assertEqual(AuditEvent.objects.filter(complaint=self.complaint).count(), before_audits)

    def test_reopen_resets_old_cycle_and_same_employee_completes_a_fresh_cycle(self):
        old_assignment = self._complete_and_close_cycle(self.worker, "First cycle repair.")
        old_resolution = self.complaint.resolution
        old_closed_at = self.complaint.closed_at

        dept_client = APIClient()
        dept_client.force_authenticate(self.admin)
        denied = dept_client.post(
            f"/api/admin/complaints/{self.complaint.pk}/reopen",
            {"reason": "Department admin must not reopen."},
            format="json",
        )
        self.assertEqual(denied.status_code, 403)

        super_admin, client, response = self._reopen_as_super_admin()
        self.assertEqual(response.status_code, 200, response.data)
        self.complaint.refresh_from_db()
        old_assignment.refresh_from_db()
        self.assertEqual(self.complaint.status, Complaint.Status.SUBMITTED)
        self.assertEqual(self.complaint.resolution, "")
        self.assertIsNone(self.complaint.resolved_at)
        self.assertIsNone(self.complaint.closed_at)
        self.assertNotEqual(old_closed_at, None)
        self.assertEqual(old_assignment.status, WorkAssignment.Status.CANCELED)
        self.assertFalse(old_assignment.is_current)
        self.assertIsNone(WorkAssignment.objects.filter(complaint=self.complaint, is_current=True).first())

        reopen_history = ComplaintStatusHistory.objects.filter(
            complaint=self.complaint, new_status=Complaint.Status.SUBMITTED,
        ).latest("created_at")
        self.assertEqual(reopen_history.actor, super_admin)
        self.assertEqual(reopen_history.note, "Reopen for another repair cycle.")
        self.assertEqual(reopen_history.metadata["previous_resolution"], old_resolution)
        self.assertEqual(reopen_history.metadata["previous_assignment"]["id"], old_assignment.pk)
        reopen_event = AuditEvent.objects.get(complaint=self.complaint, action="COMPLAINT_REOPENED")
        self.assertEqual(reopen_event.metadata["reason"], "Reopen for another repair cycle.")
        self.assertEqual(reopen_event.previous_value["resolution"], old_resolution)

        audit_count = AuditEvent.objects.filter(complaint=self.complaint).count()
        old_accept = APIClient()
        old_accept.force_authenticate(self.worker)
        response = old_accept.post(f"/api/assignments/{old_assignment.pk}/accept", {}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        response = dept_client.patch(
            f"/api/admin/complaints/{self.complaint.pk}/resolution",
            {"resolution": "Premature resolution."},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.data)
        response = dept_client.patch(
            f"/api/admin/complaints/{self.complaint.pk}/status",
            {"status": Complaint.Status.CLOSED},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(AuditEvent.objects.filter(complaint=self.complaint).count(), audit_count)

        new_assignment = assign_complaint(complaint=self.complaint, actor=self.admin, employee=self.worker)
        self.assertNotEqual(new_assignment.pk, old_assignment.pk)
        self.assertEqual(new_assignment.employee, self.worker)
        self._complete_and_close_cycle(self.worker, "Freshly verified repair.")
        old_assignment.refresh_from_db()
        self.assertEqual(old_assignment.status, WorkAssignment.Status.CANCELED)
        self.assertFalse(old_assignment.is_current)
        self.assertEqual(self.complaint.resolution, "Freshly verified repair.")

    def test_reopened_complaint_can_be_assigned_to_a_different_employee(self):
        self._complete_and_close_cycle(self.worker, "First cycle repair.")
        old_assignment = WorkAssignment.objects.get(complaint=self.complaint, is_current=True)
        _, _, response = self._reopen_as_super_admin()
        self.assertEqual(response.status_code, 200, response.data)
        different_worker = User.objects.create_user(
            "second-electrician@example.com", name="Second Electrician", password=PASSWORD,
            role=UserRole.EMPLOYEE,
        )
        EmployeeProfile.objects.create(
            user=different_worker, department=self.electrical, job_title="Technician",
        )

        new_assignment = assign_complaint(
            complaint=self.complaint, actor=self.admin, employee=different_worker,
        )
        self.assertNotEqual(new_assignment.pk, old_assignment.pk)
        self.assertEqual(new_assignment.employee, different_worker)
        old_assignment.refresh_from_db()
        self.assertEqual(old_assignment.status, WorkAssignment.Status.CANCELED)
        self.assertFalse(old_assignment.is_current)
        self._complete_and_close_cycle(different_worker, "Second employee verified repair.")
        self.assertEqual(self.complaint.resolution, "Second employee verified repair.")

    def test_reopen_rolls_back_all_database_changes_if_audit_creation_fails(self):
        old_assignment = self._complete_and_close_cycle(self.worker, "First cycle repair.")
        self.complaint.refresh_from_db()
        original_history_count = ComplaintStatusHistory.objects.filter(complaint=self.complaint).count()
        original_audit_count = AuditEvent.objects.filter(complaint=self.complaint).count()
        original_closed_at = self.complaint.closed_at
        super_admin = User.objects.create_superuser(
            "rollback-super-admin@example.com", name="Rollback Super Admin", password=PASSWORD,
        )
        client = APIClient()
        client.force_authenticate(super_admin)

        with patch("complaints.services.log_event", side_effect=RuntimeError("Audit write failed")):
            with self.assertRaises(RuntimeError):
                client.post(
                    f"/api/admin/complaints/{self.complaint.pk}/reopen",
                    {"reason": "This attempt must roll back."},
                    format="json",
                )

        self.complaint.refresh_from_db()
        old_assignment.refresh_from_db()
        self.assertEqual(self.complaint.status, Complaint.Status.CLOSED)
        self.assertEqual(self.complaint.resolution, "First cycle repair.")
        self.assertEqual(self.complaint.closed_at, original_closed_at)
        self.assertEqual(old_assignment.status, WorkAssignment.Status.VERIFIED)
        self.assertTrue(old_assignment.is_current)
        self.assertEqual(ComplaintStatusHistory.objects.filter(complaint=self.complaint).count(), original_history_count)
        self.assertEqual(AuditEvent.objects.filter(complaint=self.complaint).count(), original_audit_count)

    def test_assignment_endpoints_require_jwt(self):
        self.assertEqual(APIClient().get("/api/assignments/me").status_code, 401)

    def test_department_reassignment_retires_old_employee_assignment_before_new_assignment(self):
        old_assignment = assign_complaint(
            complaint=self.complaint, actor=self.admin, employee=self.worker,
        )
        super_admin = User.objects.create_superuser(
            "department-route-admin@example.com", name="Department Route Admin", password=PASSWORD,
        )

        reassign_complaint_department(
            complaint=self.complaint,
            actor=super_admin,
            department=self.plumbing,
            reason="Route work to plumbing.",
        )
        old_assignment.refresh_from_db()
        self.complaint.refresh_from_db()
        self.assertFalse(old_assignment.is_current)
        self.assertEqual(old_assignment.status, WorkAssignment.Status.REASSIGNED)
        self.assertEqual(self.complaint.department, self.plumbing)
        self.assertIsNone(self.complaint.assigned_employee)

        new_assignment = assign_complaint(
            complaint=self.complaint, actor=super_admin, employee=self.other_worker,
        )
        self.assertEqual(new_assignment.employee, self.other_worker)
        self.assertNotEqual(new_assignment.pk, old_assignment.pk)
        self.assertEqual(
            WorkAssignment.objects.filter(complaint=self.complaint, is_current=True).count(),
            1,
        )

    def test_evidence_and_audit_roll_back_and_saved_file_is_removed_on_failure(self):
        assignment = assign_complaint(
            complaint=self.complaint, actor=self.admin, employee=self.worker,
        )
        with TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                uploaded = SimpleUploadedFile("proof.txt", b"repair evidence", content_type="text/plain")
                with patch(
                    "assignments.services.log_event",
                    side_effect=RuntimeError("Audit write failed"),
                ):
                    with self.assertRaises(RuntimeError):
                        create_work_evidence(
                            assignment=assignment, actor=self.worker, uploaded_file=uploaded,
                        )

                self.assertFalse(WorkAssignment.objects.get(pk=assignment.pk).evidence.exists())
                self.assertEqual(list(os.walk(media_root))[0][2], [])

    def test_successful_evidence_creation_keeps_file_and_audit(self):
        assignment = assign_complaint(
            complaint=self.complaint, actor=self.admin, employee=self.worker,
        )
        with TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                uploaded = SimpleUploadedFile("proof.txt", b"repair evidence", content_type="text/plain")
                evidence = create_work_evidence(
                    assignment=assignment, actor=self.worker, uploaded_file=uploaded,
                )

                self.assertTrue(os.path.isfile(evidence.file.path))
                self.assertTrue(
                    AuditEvent.objects.filter(
                        complaint=self.complaint,
                        action="WORK_EVIDENCE_ADDED",
                        metadata__assignment_id=assignment.pk,
                    ).exists()
                )

    def test_assignment_read_endpoints_enforce_employee_ownership_and_department_scope(self):
        electrical_assignment = assign_complaint(
            complaint=self.complaint, actor=self.admin, employee=self.worker,
        )
        plumbing_complaint = create_complaint(
            actor=self.owner, title="Leaking pipe", description="Pipe is leaking", category="Plumbing",
        )
        super_admin = User.objects.create_superuser(
            "assignment-read-super@example.com", name="Super Admin", password=PASSWORD,
        )
        plumbing_assignment = assign_complaint(
            complaint=plumbing_complaint, actor=super_admin, employee=self.other_worker,
        )

        employee_client = APIClient()
        employee_client.force_authenticate(self.worker)
        for path in ("/api/assignments", "/api/assignments/me"):
            response = employee_client.get(path)
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(response.data["count"], 1)
            self.assertEqual(response.data["assignments"][0]["id"], electrical_assignment.pk)
        self.assertEqual(employee_client.get(f"/api/assignments/{electrical_assignment.pk}").status_code, 200)
        self.assertEqual(employee_client.get(f"/api/assignments/{plumbing_assignment.pk}").status_code, 404)
        self.assertEqual(employee_client.get("/api/assignments/999999").status_code, 404)

        user_client = APIClient()
        user_client.force_authenticate(self.owner)
        self.assertEqual(user_client.get("/api/assignments").status_code, 403)
        self.assertEqual(user_client.get("/api/assignments/me").status_code, 403)
        self.assertEqual(user_client.get(f"/api/assignments/{electrical_assignment.pk}").status_code, 403)

        admin_client = APIClient()
        admin_client.force_authenticate(self.admin)
        scoped = admin_client.get("/api/assignments")
        self.assertEqual(scoped.status_code, 200, scoped.data)
        self.assertEqual([row["id"] for row in scoped.data["assignments"]], [electrical_assignment.pk])
        self.assertEqual(admin_client.get("/api/assignments/me").status_code, 403)

        super_client = APIClient()
        super_client.force_authenticate(super_admin)
        all_assignments = super_client.get("/api/assignments")
        self.assertEqual(all_assignments.status_code, 200, all_assignments.data)
        self.assertEqual(all_assignments.data["count"], 2)

    def test_assignment_list_query_filters_and_creation_endpoint(self):
        original = assign_complaint(
            complaint=self.complaint, actor=self.admin, employee=self.worker,
        )
        second_worker = User.objects.create_user(
            "second-electrician@example.com", name="Second Electrician", password=PASSWORD,
            role=UserRole.EMPLOYEE,
        )
        EmployeeProfile.objects.create(user=second_worker, department=self.electrical)
        reassigned = assign_complaint(
            complaint=self.complaint, actor=self.admin, employee=second_worker,
        )
        client = APIClient()
        client.force_authenticate(self.admin)
        current_rows = client.get("/api/assignments?current=true")
        self.assertEqual([row["id"] for row in current_rows.data["assignments"]], [reassigned.pk])
        history_rows = client.get("/api/assignments?current=false&status=REASSIGNED")
        self.assertEqual([row["id"] for row in history_rows.data["assignments"]], [original.pk])

        owner_client = APIClient()
        owner_client.force_authenticate(self.owner)
        self.assertEqual(owner_client.post("/api/assignments", {}, format="json").status_code, 403)

        self.assertEqual(
            client.post("/api/assignments", {"complaint_id": "missing", "employee_id": self.worker.pk}, format="json").status_code,
            400,
        )
        self.assertEqual(
            client.post("/api/assignments", {"complaint_id": self.complaint.complaint_id, "employee_id": 999999}, format="json").status_code,
            400,
        )

        unassigned = create_complaint(
            actor=self.owner, title="Loose cable", description="Cable needs repair", category="Electrical",
        )
        created = client.post(
            "/api/assignments",
            {"complaint_id": unassigned.complaint_id, "employee_id": self.worker.pk},
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data["employee"]["id"], self.worker.pk)

    def test_assignment_action_api_accepts_tracks_progress_completes_and_verifies(self):
        assignment = assign_complaint(
            complaint=self.complaint, actor=self.admin, employee=self.worker,
        )
        employee_client = APIClient()
        employee_client.force_authenticate(self.worker)

        accepted = employee_client.post(f"/api/assignments/{assignment.pk}/accept", {}, format="json")
        self.assertEqual(accepted.status_code, 200, accepted.data)
        self.assertEqual(accepted.data["status"], WorkAssignment.Status.ACCEPTED)
        self.assertEqual(employee_client.post(f"/api/assignments/{assignment.pk}/accept", {}, format="json").status_code, 400)
        self.assertEqual(
            employee_client.post(
                f"/api/assignments/{assignment.pk}/complete", {"note": "Too early."}, format="json",
            ).status_code,
            400,
        )
        self.assertEqual(
            employee_client.post(
                f"/api/assignments/{assignment.pk}/progress", {"progress_percent": 101}, format="json",
            ).status_code,
            400,
        )

        progress = employee_client.post(
            f"/api/assignments/{assignment.pk}/progress",
            {"note": "Started the repair.", "progress_percent": 25},
            format="json",
        )
        self.assertEqual(progress.status_code, 200, progress.data)
        # API response should reflect the state that the progress action persisted.
        self.assertEqual(progress.data["status"], WorkAssignment.Status.IN_PROGRESS)
        assignment.refresh_from_db()
        self.assertEqual(assignment.status, WorkAssignment.Status.IN_PROGRESS)

        premature_admin = APIClient()
        premature_admin.force_authenticate(self.admin)
        self.assertEqual(
            premature_admin.post(
                f"/api/assignments/{assignment.pk}/verify", {"resolution": "Too early."}, format="json",
            ).status_code,
            400,
        )
        completed = employee_client.post(
            f"/api/assignments/{assignment.pk}/complete", {"note": "Repair finished."}, format="json",
        )
        self.assertEqual(completed.status_code, 200, completed.data)
        self.assertEqual(completed.data["status"], WorkAssignment.Status.COMPLETED)
        self.assertEqual(
            employee_client.post(
                f"/api/assignments/{assignment.pk}/verify", {"resolution": "Not an admin."}, format="json",
            ).status_code,
            403,
        )
        self.assertEqual(
            premature_admin.post(
                f"/api/assignments/{assignment.pk}/verify", {"resolution": "   "}, format="json",
            ).status_code,
            400,
        )
        verified = premature_admin.post(
            f"/api/assignments/{assignment.pk}/verify",
            {"resolution": "Repaired and tested."},
            format="json",
        )
        self.assertEqual(verified.status_code, 200, verified.data)
        self.assertEqual(verified.data["status"], WorkAssignment.Status.VERIFIED)
        self.assertEqual(
            employee_client.post(f"/api/assignments/{assignment.pk}/unknown", {}, format="json").status_code,
            403,
        )

    def test_assignment_reassign_action_and_department_workload_api(self):
        assignment = assign_complaint(
            complaint=self.complaint, actor=self.admin, employee=self.worker,
        )
        second_worker = User.objects.create_user(
            "replacement-electrician@example.com", name="Replacement Electrician", password=PASSWORD,
            role=UserRole.EMPLOYEE,
        )
        EmployeeProfile.objects.create(user=second_worker, department=self.electrical)

        client = APIClient()
        client.force_authenticate(self.admin)
        reassigned = client.post(
            f"/api/assignments/{assignment.pk}/reassign",
            {"employee_id": second_worker.pk},
            format="json",
        )
        self.assertEqual(reassigned.status_code, 200, reassigned.data)
        self.assertEqual(reassigned.data["employee"]["id"], second_worker.pk)
        self.assertFalse(WorkAssignment.objects.get(pk=assignment.pk).is_current)

        workload = client.get("/api/assignments/workload")
        self.assertEqual(workload.status_code, 200, workload.data)
        self.assertEqual({row["employee"]["id"] for row in workload.data["employees"]}, {self.worker.pk, second_worker.pk})

        super_admin = User.objects.create_superuser(
            "workload-super@example.com", name="Workload Super Admin", password=PASSWORD,
        )
        super_client = APIClient()
        super_client.force_authenticate(super_admin)
        filtered = super_client.get(f"/api/assignments/workload?department={self.electrical.pk}")
        self.assertEqual(filtered.status_code, 200, filtered.data)
        self.assertEqual(len(filtered.data["employees"]), 2)
        self.assertEqual(super_client.get("/api/assignments/workload?department=bad").status_code, 403)

        employee_client = APIClient()
        employee_client.force_authenticate(self.worker)
        self.assertEqual(employee_client.get("/api/assignments/workload").status_code, 403)

    def test_workload_api_requires_department_profile_and_preserves_super_admin_scope(self):
        client = APIClient()
        client.force_authenticate(self.admin)
        department_response = client.get("/api/assignments/workload")
        self.assertEqual(department_response.status_code, 200, department_response.data)
        self.assertEqual(
            {row["employee"]["id"] for row in department_response.data["employees"]},
            {self.worker.pk},
        )

        profileless_admin = User.objects.create_user(
            "profileless-admin@example.com", name="Profileless Admin", password=PASSWORD,
            role=UserRole.DEPARTMENT_ADMIN,
        )
        client.force_authenticate(profileless_admin)
        denied = client.get("/api/assignments/workload")
        self.assertEqual(denied.status_code, 403, denied.data)
        self.assertNotIn("employees", denied.data)

        super_admin = User.objects.create_superuser(
            "cross-department-workload@example.com", name="Super Admin", password=PASSWORD,
        )
        client.force_authenticate(super_admin)
        organization_response = client.get("/api/assignments/workload")
        self.assertEqual(organization_response.status_code, 200, organization_response.data)
        self.assertEqual(
            {row["employee"]["id"] for row in organization_response.data["employees"]},
            {self.worker.pk, self.other_worker.pk},
        )

    def test_evidence_api_validates_uploads_and_scopes_access(self):
        assignment = assign_complaint(
            complaint=self.complaint, actor=self.admin, employee=self.worker,
        )
        client = APIClient()
        client.force_authenticate(self.worker)

        for invalid_upload in (
            SimpleUploadedFile("notes.txt", b"not an allowed file", content_type="text/plain"),
            SimpleUploadedFile("empty.pdf", b"", content_type="application/pdf"),
            SimpleUploadedFile("large.pdf", b"x" * (10 * 1024 * 1024 + 1), content_type="application/pdf"),
        ):
            with self.subTest(filename=invalid_upload.name):
                response = client.post(
                    f"/api/assignments/{assignment.pk}/evidence", {"file": invalid_upload}, format="multipart",
                )
                self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(client.post(f"/api/assignments/{assignment.pk}/evidence", {}, format="multipart").status_code, 400)

        self.assertEqual(client.post("/api/assignments/999999/evidence", {}, format="multipart").status_code, 404)
        owner_client = APIClient()
        owner_client.force_authenticate(self.owner)
        self.assertEqual(
            owner_client.post(
                f"/api/assignments/{assignment.pk}/evidence", {}, format="multipart",
            ).status_code,
            403,
        )

        with TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                valid_upload = SimpleUploadedFile("repair.pdf", b"%PDF-evidence", content_type="application/pdf")
                response = client.post(
                    f"/api/assignments/{assignment.pk}/evidence", {"file": valid_upload}, format="multipart",
                )
                self.assertEqual(response.status_code, 201, response.data)
                self.assertEqual(response.data["original_name"], "repair.pdf")
                self.assertEqual(WorkEvidence.objects.filter(assignment=assignment).count(), 1)
