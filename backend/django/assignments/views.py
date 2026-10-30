from django.db.models import Count, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import PermissionDenied
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import EmployeeProfile
from accounts.roles import UserRole, department_for_user, has_role
from assignments.models import WorkAssignment
from assignments.serializers import (
    AssignmentCreateSerializer,
    AssignmentReadSerializer,
    CompleteWorkSerializer,
    ProgressSerializer,
    ReassignSerializer,
    VerifyWorkSerializer,
    WorkEvidenceSerializer,
)
from assignments.services import (
    accept_assignment,
    assign_complaint,
    complete_assignment,
    create_work_evidence,
    update_assignment_progress,
    verify_assignment,
)
from complaints.serializers import ComplaintAttachmentCreateSerializer


def visible_assignments(user):
    queryset = WorkAssignment.objects.select_related(
        "complaint",
        "complaint__department",
        "complaint__submitted_by",
        "employee",
        "assigned_by",
        "reassigned_from",
    ).prefetch_related("updates__actor", "evidence__uploaded_by")
    if has_role(user, UserRole.SUPER_ADMIN):
        return queryset
    if has_role(user, UserRole.DEPARTMENT_ADMIN):
        department = department_for_user(user)
        return queryset.filter(complaint__department=department) if department else queryset.none()
    if has_role(user, UserRole.EMPLOYEE):
        return queryset.filter(employee=user)
    return queryset.none()


def get_assignment_for_user(user, assignment_id):
    if not has_role(user, UserRole.SUPER_ADMIN, UserRole.DEPARTMENT_ADMIN, UserRole.EMPLOYEE):
        raise PermissionDenied("Work assignment access is not available to this account.")
    return get_object_or_404(visible_assignments(user), pk=assignment_id)


def _workload_for_department(department_id=None):
    profiles = EmployeeProfile.objects.select_related("user", "department").filter(user__is_active=True)
    if department_id is not None:
        profiles = profiles.filter(department_id=department_id)
    assignment_qs = WorkAssignment.objects.filter(is_current=True)
    now = timezone.now()
    result = []
    for profile in profiles:
        rows = assignment_qs.filter(employee=profile.user)
        summary = rows.aggregate(
            assigned=Count("id", filter=Q(status=WorkAssignment.Status.ASSIGNED)),
            accepted=Count("id", filter=Q(status=WorkAssignment.Status.ACCEPTED)),
            in_progress=Count("id", filter=Q(status=WorkAssignment.Status.IN_PROGRESS)),
            completed_awaiting_verification=Count("id", filter=Q(status=WorkAssignment.Status.COMPLETED)),
            overdue=Count(
                "id",
                filter=Q(due_at__lt=now)
                & ~Q(status__in=[WorkAssignment.Status.VERIFIED, WorkAssignment.Status.CANCELED]),
            ),
        )
        result.append(
            {
                "employee": {
                    "id": profile.user_id,
                    "name": profile.user.name,
                    "email": profile.user.email,
                    "job_title": profile.job_title,
                },
                "department": {"id": profile.department_id, "name": profile.department.name},
                "active_assignments": (
                    summary["assigned"]
                    + summary["accepted"]
                    + summary["in_progress"]
                    + summary["completed_awaiting_verification"]
                ),
                "assigned": summary["assigned"],
                "accepted": summary["accepted"],
                "in_progress": summary["in_progress"],
                "completed_awaiting_verification": summary["completed_awaiting_verification"],
                "overdue": summary["overdue"],
                "completed_total": WorkAssignment.objects.filter(
                    employee=profile.user,
                    status=WorkAssignment.Status.VERIFIED,
                ).count(),
            }
        )
    return result


class AssignmentListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not has_role(request.user, UserRole.SUPER_ADMIN, UserRole.DEPARTMENT_ADMIN, UserRole.EMPLOYEE):
            raise PermissionDenied("Work assignments are not available to this account.")
        rows = visible_assignments(request.user)
        if request.query_params.get("current", "true").lower() == "true":
            rows = rows.filter(is_current=True)
        if request.query_params.get("status"):
            rows = rows.filter(status=request.query_params["status"])
        data = AssignmentReadSerializer(rows, many=True, context={"request": request}).data
        return Response({"count": len(data), "assignments": data})

    def post(self, request):
        if not has_role(request.user, UserRole.SUPER_ADMIN, UserRole.DEPARTMENT_ADMIN):
            raise PermissionDenied("Only department administrators can assign work.")
        serializer = AssignmentCreateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        assignment = serializer.save()
        return Response(
            AssignmentReadSerializer(assignment, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class MyAssignmentsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if request.user.role != UserRole.EMPLOYEE:
            raise PermissionDenied("This view is for employees.")
        assignments = visible_assignments(request.user).order_by("-assigned_at")
        data = AssignmentReadSerializer(assignments, many=True, context={"request": request}).data
        return Response({"count": len(data), "assignments": data})


class AssignmentDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, assignment_id):
        assignment = get_assignment_for_user(request.user, assignment_id)
        return Response(AssignmentReadSerializer(assignment, context={"request": request}).data)


class AssignmentActionView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, assignment_id, action):
        assignment = get_assignment_for_user(request.user, assignment_id)

        if action == "accept":
            assignment = accept_assignment(assignment=assignment, actor=request.user)
        elif action == "progress":
            serializer = ProgressSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            update_assignment_progress(
                assignment=assignment,
                actor=request.user,
                note=serializer.validated_data.get("note", ""),
                progress_percent=serializer.validated_data.get("progress_percent"),
            )
        elif action == "complete":
            serializer = CompleteWorkSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            assignment = complete_assignment(
                assignment=assignment,
                actor=request.user,
                note=serializer.validated_data.get("note", ""),
            )
        elif action == "verify":
            if not has_role(request.user, UserRole.SUPER_ADMIN, UserRole.DEPARTMENT_ADMIN):
                raise PermissionDenied("Only department administrators can verify completed work.")
            serializer = VerifyWorkSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            assignment = verify_assignment(
                assignment=assignment,
                actor=request.user,
                resolution=serializer.validated_data["resolution"],
            )
        elif action == "reassign":
            if not has_role(request.user, UserRole.SUPER_ADMIN, UserRole.DEPARTMENT_ADMIN):
                raise PermissionDenied("Only department administrators can reassign work.")
            serializer = ReassignSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            assignment = assign_complaint(
                complaint=assignment.complaint,
                actor=request.user,
                employee=serializer.validated_data["employee"],
                due_at=serializer.validated_data.get("due_at"),
                override_reason=serializer.validated_data.get("reason", ""),
            )
        else:
            raise PermissionDenied("Unknown work action.")

        return Response(AssignmentReadSerializer(assignment, context={"request": request}).data)


class AssignmentEvidenceView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, assignment_id):
        assignment = get_assignment_for_user(request.user, assignment_id)
        serializer = ComplaintAttachmentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        evidence = create_work_evidence(
            assignment=assignment,
            actor=request.user,
            uploaded_file=serializer.validated_data["file"],
        )
        return Response(
            WorkEvidenceSerializer(evidence, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class WorkloadView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        if has_role(request.user, UserRole.SUPER_ADMIN):
            department_id = request.query_params.get("department")
            if department_id and not str(department_id).isdigit():
                raise PermissionDenied("Invalid department filter.")
        elif has_role(request.user, UserRole.DEPARTMENT_ADMIN):
            department = department_for_user(request.user)
            department_id = department.pk if department else None
        else:
            raise PermissionDenied("Employee workload is visible to department administrators.")
        return Response({"employees": _workload_for_department(int(department_id) if department_id else None)})
