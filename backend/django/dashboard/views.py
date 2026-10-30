from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db.models import Count, Q
from django.db.models.functions import TruncDate
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import EmployeeProfile
from accounts.roles import UserRole, department_for_user, has_role
from assignments.models import WorkAssignment
from assignments.views import _workload_for_department, visible_assignments
from audit.models import AuditEvent
from audit.serializers import AuditEventSerializer
from complaints.models import Complaint
from complaints.serializers import ComplaintReadSerializer
from complaints.views import filter_complaints, visible_complaints_for
from departments.models import Department
from assignments.serializers import AssignmentReadSerializer

User = get_user_model()


def _stats(queryset):
    return {
        "total": queryset.count(),
        "pending": queryset.exclude(status__in=[Complaint.Status.RESOLVED, Complaint.Status.CLOSED]).count(),
        "critical": queryset.filter(priority=Complaint.Priority.CRITICAL).count(),
        "resolved": queryset.filter(status=Complaint.Status.RESOLVED).count(),
        "closed": queryset.filter(status=Complaint.Status.CLOSED).count(),
    }


def _recent_events(queryset, limit=10):
    return AuditEventSerializer(queryset.select_related("actor", "department", "complaint")[:limit], many=True).data


class DashboardSummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        if user.role == UserRole.USER:
            complaints = filter_complaints(visible_complaints_for(user), request.query_params)
            return Response({"role": user.role, "stats": _stats(complaints)})

        if user.role == UserRole.EMPLOYEE:
            assignments = visible_assignments(user)
            current = assignments.filter(is_current=True)
            complaint_ids = current.values_list("complaint_id", flat=True)
            complaints = filter_complaints(visible_complaints_for(user), request.query_params)
            complaints = complaints.filter(pk__in=complaint_ids)
            pending_statuses = [
                WorkAssignment.Status.ASSIGNED,
                WorkAssignment.Status.ACCEPTED,
                WorkAssignment.Status.IN_PROGRESS,
            ]
            return Response(
                {
                    "role": user.role,
                    "stats": {
                        "my_assignments": current.count(),
                        "new_assignments": current.filter(status=WorkAssignment.Status.ASSIGNED).count(),
                        "accepted": current.filter(status=WorkAssignment.Status.ACCEPTED).count(),
                        "in_progress": current.filter(status=WorkAssignment.Status.IN_PROGRESS).count(),
                        "completed": assignments.filter(
                            status__in=[WorkAssignment.Status.COMPLETED, WorkAssignment.Status.VERIFIED]
                        ).count(),
                        "overdue": current.filter(
                            due_at__lt=timezone.now(),
                            status__in=pending_statuses + [WorkAssignment.Status.COMPLETED],
                        ).count(),
                    },
                    "assignments": AssignmentReadSerializer(current, many=True, context={"request": request}).data,
                    "work_history": AssignmentReadSerializer(
                        assignments.filter(
                            status__in=[
                                WorkAssignment.Status.COMPLETED,
                                WorkAssignment.Status.VERIFIED,
                                WorkAssignment.Status.REASSIGNED,
                            ]
                        ),
                        many=True,
                        context={"request": request},
                    ).data,
                    "complaints": ComplaintReadSerializer(complaints, many=True, context={"request": request}).data,
                }
            )

        if user.role not in (UserRole.SUPER_ADMIN, UserRole.DEPARTMENT_ADMIN):
            raise PermissionDenied("No dashboard is available for this account.")

        complaints = filter_complaints(visible_complaints_for(user), request.query_params)
        now = timezone.now()
        overdue = complaints.exclude(
            status__in=[Complaint.Status.RESOLVED, Complaint.Status.CLOSED]
        ).filter(due_at__lt=now)
        activities = AuditEvent.objects.all()

        if user.role == UserRole.SUPER_ADMIN:
            department_stats = list(
                complaints.values("department_id", "department__name")
                .annotate(
                    total=Count("id"),
                    pending=Count("id", filter=~Q(status__in=[Complaint.Status.RESOLVED, Complaint.Status.CLOSED])),
                    critical=Count("id", filter=Q(priority=Complaint.Priority.CRITICAL)),
                    resolved=Count("id", filter=Q(status=Complaint.Status.RESOLVED)),
                    closed=Count("id", filter=Q(status=Complaint.Status.CLOSED)),
                )
                .order_by("department__name")
            )
            priority_distribution = list(
                complaints.values("priority").annotate(total=Count("id")).order_by("priority")
            )
            trends = list(
                complaints.filter(resolved_at__gte=now - timedelta(days=30))
                .annotate(day=TruncDate("resolved_at"))
                .values("day")
                .annotate(resolved=Count("id"))
                .order_by("day")
            )
            activities = activities
            return Response(
                {
                    "role": user.role,
                    "stats": {
                        **_stats(complaints),
                        "overdue": overdue.count(),
                    },
                    "organization_counts": {
                        "departments": Department.objects.filter(is_active=True).count(),
                        "department_admins": User.objects.filter(role=UserRole.DEPARTMENT_ADMIN, is_active=True).count(),
                        "employees": User.objects.filter(role=UserRole.EMPLOYEE, is_active=True).count(),
                    },
                    "department_stats": department_stats,
                    "priority_distribution": priority_distribution,
                    "employee_workload": _workload_for_department(),
                    "overdue_complaints": ComplaintReadSerializer(overdue, many=True, context={"request": request}).data,
                    "resolution_trends": trends,
                    "recent_activities": _recent_events(activities),
                }
            )

        department = department_for_user(user)
        if department is None:
            raise PermissionDenied("A department admin profile is required.")
        scoped = visible_complaints_for(user)
        assignments = WorkAssignment.objects.filter(complaint__department=department, is_current=True)
        employees = _workload_for_department(department.pk)
        dept_events = AuditEvent.objects.filter(department=department)
        return Response(
            {
                "role": user.role,
                "department": {"id": department.pk, "name": department.name},
                "stats": {
                    **_stats(scoped),
                    "new": scoped.filter(status=Complaint.Status.SUBMITTED).count(),
                    "unassigned": scoped.filter(assigned_employee__isnull=True).exclude(
                        status__in=[Complaint.Status.RESOLVED, Complaint.Status.CLOSED]
                    ).count(),
                    "assigned": assignments.exclude(status=WorkAssignment.Status.CANCELED).count(),
                    "in_progress": scoped.filter(status=Complaint.Status.IN_PROGRESS).count(),
                    "work_completed_awaiting_verification": scoped.filter(
                        status=Complaint.Status.WORK_COMPLETED
                    ).count(),
                    "overdue": overdue.count(),
                },
                "employees": employees,
                "recent_activities": _recent_events(dept_events),
                "complaints": ComplaintReadSerializer(complaints, many=True, context={"request": request}).data,
                "overdue_complaints": ComplaintReadSerializer(overdue, many=True, context={"request": request}).data,
            }
        )


class EmployeeDashboardDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, employee_id):
        profile = get_object_or_404(EmployeeProfile.objects.select_related("user", "department"), pk=employee_id)
        if has_role(request.user, UserRole.DEPARTMENT_ADMIN):
            department = department_for_user(request.user)
            if department is None or profile.department_id != department.pk:
                raise PermissionDenied("You can inspect employees only in your department.")
        elif has_role(request.user, UserRole.EMPLOYEE):
            if profile.user_id != request.user.pk:
                raise PermissionDenied("You can inspect only your own work history.")
        elif not has_role(request.user, UserRole.SUPER_ADMIN):
            raise PermissionDenied("Employee work details are not available to this account.")

        assignments = WorkAssignment.objects.filter(employee=profile.user).select_related("complaint", "employee", "assigned_by").prefetch_related("updates", "evidence")
        active = assignments.filter(is_current=True)
        return Response(
            {
                "employee": {
                    "id": profile.user_id,
                    "name": profile.user.name,
                    "email": profile.user.email,
                    "job_title": profile.job_title,
                    "department": {"id": profile.department_id, "name": profile.department.name},
                },
                "stats": {
                    "assigned": active.filter(status=WorkAssignment.Status.ASSIGNED).count(),
                    "accepted": active.filter(status=WorkAssignment.Status.ACCEPTED).count(),
                    "in_progress": active.filter(status=WorkAssignment.Status.IN_PROGRESS).count(),
                    "completed": assignments.filter(status=WorkAssignment.Status.VERIFIED).count(),
                    "overdue": active.filter(due_at__lt=timezone.now()).exclude(
                        status__in=[WorkAssignment.Status.VERIFIED, WorkAssignment.Status.CANCELED]
                    ).count(),
                },
                "assignments": AssignmentReadSerializer(active, many=True, context={"request": request}).data,
                "work_history": AssignmentReadSerializer(
                    assignments.filter(
                        status__in=[
                            WorkAssignment.Status.COMPLETED,
                            WorkAssignment.Status.VERIFIED,
                            WorkAssignment.Status.REASSIGNED,
                        ]
                    ),
                    many=True,
                    context={"request": request},
                ).data,
            }
        )
