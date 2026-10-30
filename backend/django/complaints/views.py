from datetime import datetime, time

from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from accounts.permissions import IsSuperAdmin
from accounts.roles import UserRole, department_for_user, has_role
from audit.models import AuditEvent
from audit.services import log_event
from complaints.models import (
    CategoryDepartmentMapping,
    Complaint,
    ComplaintAttachment,
    ComplaintStatusHistory,
    PriorityPolicy,
)
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
from complaints.services import (
    actor_can_manage_complaint,
    override_priority,
    reopen_complaint,
    save_resolution,
    transition_complaint,
)
from assignments.services import reassign_complaint_department
from notifications.services import notify_complaint_stakeholders


def _base_complaints():
    return Complaint.objects.select_related(
        "submitted_by",
        "department",
        "assigned_employee",
    ).prefetch_related(
        "status_history__actor",
        "attachments__uploaded_by",
    )


def visible_complaints_for(user):
    queryset = _base_complaints()
    if has_role(user, UserRole.SUPER_ADMIN):
        return queryset
    if has_role(user, UserRole.DEPARTMENT_ADMIN):
        department = department_for_user(user)
        return queryset.filter(department=department) if department else queryset.none()
    if has_role(user, UserRole.EMPLOYEE):
        return queryset.filter(assigned_employee=user)
    if has_role(user, UserRole.USER):
        return queryset.filter(submitted_by=user)
    return queryset.none()


def find_visible_complaint(user, lookup):
    query = Q(complaint_id=lookup) | Q(legacy_mongo_id=lookup)
    if str(lookup).isdigit():
        query |= Q(pk=int(lookup))
    return get_object_or_404(visible_complaints_for(user).filter(query))


def require_complaint_manager(user):
    if not has_role(user, UserRole.SUPER_ADMIN, UserRole.DEPARTMENT_ADMIN):
        raise PermissionDenied("Complaint management access is required.")


def filter_complaints(queryset, params):
    search = params.get("search")
    if search:
        queryset = queryset.filter(
            Q(complaint_id__icontains=search)
            | Q(title__icontains=search)
            | Q(description__icontains=search)
            | Q(category__icontains=search)
            | Q(submitted_by__name__icontains=search)
        )
    for param, field in (("status", "status"), ("priority", "priority"), ("category", "category")):
        value = params.get(param)
        if value:
            queryset = queryset.filter(**{field: value})
    for param, field in (("department", "department_id"), ("employee", "assigned_employee_id")):
        value = params.get(param)
        if value and str(value).isdigit():
            queryset = queryset.filter(**{field: int(value)})
    for param, lookup in (("date_from", "created_at__date__gte"), ("date_to", "created_at__date__lte")):
        value = params.get(param)
        if value:
            try:
                datetime.strptime(value, "%Y-%m-%d")
            except ValueError as exc:
                raise ValidationError({param: "Use YYYY-MM-DD format."}) from exc
            queryset = queryset.filter(**{lookup: value})
    return queryset


def _list_response(queryset):
    complaints = ComplaintReadSerializer(queryset, many=True).data
    return Response({"count": len(complaints), "total": len(complaints), "complaints": complaints})


class ComplaintListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        queryset = filter_complaints(visible_complaints_for(request.user), request.query_params)
        return _list_response(queryset)

    def post(self, request):
        if request.user.role != UserRole.USER:
            raise PermissionDenied("Only regular users can submit complaints from this endpoint.")
        serializer = ComplaintCreateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        complaint = serializer.save()
        return Response(
            {
                "message": "Complaint submitted successfully.",
                "complaint": ComplaintReadSerializer(complaint, context={"request": request}).data,
            },
            status=status.HTTP_201_CREATED,
        )


class ComplaintDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, lookup):
        complaint = find_visible_complaint(request.user, lookup)
        return Response({"complaint": ComplaintReadSerializer(complaint, context={"request": request}).data})

    def patch(self, request, lookup):
        complaint = find_visible_complaint(request.user, lookup)
        if request.user.role == UserRole.USER and complaint.submitted_by_id != request.user.pk:
            raise PermissionDenied("You can only edit your own complaints.")
        if request.user.role != UserRole.USER and not actor_can_manage_complaint(request.user, complaint):
            raise PermissionDenied("You cannot update this complaint.")
        serializer = ComplaintUpdateSerializer(
            complaint,
            data=request.data,
            partial=True,
            context={"request": request},
        )
        serializer.is_valid(raise_exception=True)
        complaint = serializer.save()
        return Response({"complaint": ComplaintReadSerializer(complaint, context={"request": request}).data})


class ComplaintUpdatesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, lookup):
        complaint = find_visible_complaint(request.user, lookup)
        events = []
        for event in AuditEvent.objects.filter(complaint=complaint).select_related("actor"):
            actor = event.actor
            events.append(
                {
                    "id": event.pk,
                    "action": event.action,
                    "details": {
                        "previous": event.previous_value,
                        "new": event.new_value,
                        **event.metadata,
                    },
                    "createdAt": event.created_at,
                    "administrator": (
                        {"id": actor.pk, "name": actor.name, "email": actor.email}
                        if actor
                        else None
                    ),
                }
            )
        try:
            from assignments.models import WorkUpdate

            updates = WorkUpdate.objects.filter(assignment__complaint=complaint).select_related("actor")
            for update in updates:
                events.append(
                    {
                        "id": f"work-{update.pk}",
                        "action": "WORK_PROGRESS_UPDATED",
                        "details": {"note": update.note, "progressPercent": update.progress_percent},
                        "createdAt": update.created_at,
                        "administrator": {
                            "id": update.actor_id,
                            "name": update.actor.name,
                            "email": update.actor.email,
                        },
                    }
                )
        except ImportError:
            pass
        events.sort(key=lambda event: event["createdAt"])
        for event in events:
            event["createdAt"] = event["createdAt"].isoformat()
        return Response(
            {
                "complaintId": complaint.complaint_id,
                "currentStatus": complaint.status,
                "resolution": complaint.resolution,
                "count": len(events),
                "updates": events,
            }
        )


class ComplaintAttachmentView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get(self, request, lookup):
        complaint = find_visible_complaint(request.user, lookup)
        return Response(AttachmentSerializer(complaint.attachments.all(), many=True, context={"request": request}).data)

    def post(self, request, lookup):
        complaint = find_visible_complaint(request.user, lookup)
        if request.user.role == UserRole.USER:
            allowed = complaint.submitted_by_id == request.user.pk and complaint.status == Complaint.Status.SUBMITTED
            kind = ComplaintAttachment.Kind.SUBMISSION
        elif request.user.role == UserRole.EMPLOYEE:
            allowed = complaint.assigned_employee_id == request.user.pk
            kind = ComplaintAttachment.Kind.WORK_EVIDENCE
        else:
            allowed = actor_can_manage_complaint(request.user, complaint)
            kind = ComplaintAttachment.Kind.WORK_EVIDENCE
        if not allowed:
            raise PermissionDenied("You cannot attach files to this complaint.")
        serializer = ComplaintAttachmentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        uploaded = serializer.validated_data["file"]
        attachment = ComplaintAttachment.objects.create(
            complaint=complaint,
            uploaded_by=request.user,
            file=uploaded,
            original_name=uploaded.name[:255],
            content_type=getattr(uploaded, "content_type", "") or "",
            size_bytes=uploaded.size,
            kind=kind,
        )
        log_event(
            actor=request.user,
            action="COMPLAINT_ATTACHMENT_ADDED",
            complaint=complaint,
            metadata={"kind": kind, "name": attachment.original_name, "size_bytes": attachment.size_bytes},
        )
        return Response(
            AttachmentSerializer(attachment, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class AdminComplaintListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        require_complaint_manager(request.user)
        queryset = filter_complaints(visible_complaints_for(request.user), request.query_params)
        return _list_response(queryset)


class UnassignedComplaintListView(APIView):
    permission_classes = [IsAuthenticated, IsSuperAdmin]

    def get(self, request):
        queryset = filter_complaints(_base_complaints().filter(department__isnull=True), request.query_params)
        return _list_response(queryset)


class AdminComplaintDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, lookup):
        require_complaint_manager(request.user)
        complaint = find_visible_complaint(request.user, lookup)
        return Response({"complaint": ComplaintReadSerializer(complaint, context={"request": request}).data})


class AdminComplaintStatusView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, lookup):
        require_complaint_manager(request.user)
        complaint = find_visible_complaint(request.user, lookup)
        serializer = StatusChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        new_status = serializer.validated_data["status"]
        if new_status not in (
            Complaint.Status.IN_PROGRESS,
            Complaint.Status.RESOLVED,
            Complaint.Status.CLOSED,
        ):
            raise ValidationError({"status": "Use assignment actions for employee workflow statuses."})
        complaint = transition_complaint(
            complaint=complaint,
            actor=request.user,
            new_status=new_status,
            note=serializer.validated_data.get("note", ""),
            metadata={"source": "legacy_admin_api"},
        )
        return Response({"message": "Complaint status updated successfully.", "complaint": ComplaintReadSerializer(complaint).data})


class AdminComplaintResolutionView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, lookup):
        require_complaint_manager(request.user)
        complaint = find_visible_complaint(request.user, lookup)
        serializer = ResolutionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        complaint = save_resolution(
            complaint=complaint,
            actor=request.user,
            resolution=serializer.validated_data["resolution"],
        )
        return Response({"message": "Complaint resolution saved successfully.", "complaint": ComplaintReadSerializer(complaint).data})


class AdminComplaintAuditView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, lookup):
        require_complaint_manager(request.user)
        complaint = find_visible_complaint(request.user, lookup)
        events = AuditEvent.objects.filter(complaint=complaint).select_related("actor")
        audit_logs = [
            {
                "_id": event.pk,
                "administrator": (
                    {"_id": event.actor_id, "name": event.actor.name, "email": event.actor.email}
                    if event.actor
                    else None
                ),
                "complaint": complaint.pk,
                "action": event.action,
                "details": {
                    "previous": event.previous_value,
                    "new": event.new_value,
                    **event.metadata,
                },
                "createdAt": event.created_at.isoformat(),
            }
            for event in events
        ]
        return Response({"complaintId": complaint.complaint_id, "count": len(audit_logs), "auditLogs": audit_logs})


class AdminComplaintPriorityView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, lookup):
        require_complaint_manager(request.user)
        complaint = find_visible_complaint(request.user, lookup)
        serializer = PriorityOverrideSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        complaint = override_priority(
            complaint=complaint,
            actor=request.user,
            priority=serializer.validated_data["priority"],
            reason=serializer.validated_data["reason"],
        )
        return Response({"complaint": ComplaintReadSerializer(complaint).data})


class AdminComplaintReopenView(APIView):
    permission_classes = [IsAuthenticated, IsSuperAdmin]

    def post(self, request, lookup):
        complaint = find_visible_complaint(request.user, lookup)
        serializer = ReopenSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        complaint = reopen_complaint(
            complaint=complaint,
            actor=request.user,
            reason=serializer.validated_data["reason"],
        )
        return Response({"complaint": ComplaintReadSerializer(complaint).data})


class AdminComplaintDepartmentView(APIView):
    permission_classes = [IsAuthenticated, IsSuperAdmin]

    def patch(self, request, lookup):
        complaint = find_visible_complaint(request.user, lookup)
        serializer = DepartmentReassignmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        complaint = reassign_complaint_department(
            complaint=complaint,
            actor=request.user,
            department=serializer.validated_data["department"],
            reason=serializer.validated_data["reason"],
        )
        return Response({"complaint": ComplaintReadSerializer(complaint).data})


class CategoryMappingPermission(IsAuthenticated):
    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return True
        return has_role(request.user, UserRole.SUPER_ADMIN)


class CategoryDepartmentMappingViewSet(viewsets.ModelViewSet):
    serializer_class = CategoryDepartmentMappingSerializer
    permission_classes = [CategoryMappingPermission]

    def get_queryset(self):
        queryset = CategoryDepartmentMapping.objects.select_related("department")
        if has_role(self.request.user, UserRole.SUPER_ADMIN):
            return queryset
        return queryset.filter(is_active=True)

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])
        log_event(actor=self.request.user, action="CATEGORY_MAPPING_DEACTIVATED", department=instance.department,
                  previous_value={"category": instance.category, "department_id": instance.department_id},
                  new_value={"is_active": False})

    def perform_create(self, serializer):
        mapping = serializer.save()
        log_event(actor=self.request.user, action="CATEGORY_MAPPING_CREATED", department=mapping.department,
                  new_value={"category": mapping.category, "department_id": mapping.department_id,
                             "is_active": mapping.is_active})

    def perform_update(self, serializer):
        previous = {"category": serializer.instance.category,
                    "department_id": serializer.instance.department_id,
                    "is_active": serializer.instance.is_active}
        mapping = serializer.save()
        log_event(actor=self.request.user, action="CATEGORY_MAPPING_UPDATED", department=mapping.department,
                  previous_value=previous,
                  new_value={"category": mapping.category, "department_id": mapping.department_id,
                             "is_active": mapping.is_active})


class PriorityPolicyView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        require_complaint_manager(request.user)
        return Response(PriorityPolicySerializer(PriorityPolicy.active()).data)

    def patch(self, request):
        if not has_role(request.user, UserRole.SUPER_ADMIN):
            raise PermissionDenied("Only a Super Admin can configure priority policy.")
        policy = PriorityPolicy.active()
        previous = {
            field: getattr(policy, field)
            for field in request.data
            if hasattr(policy, field)
        }
        serializer = PriorityPolicySerializer(policy, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        policy = serializer.save()
        log_event(
            actor=request.user,
            action="PRIORITY_POLICY_UPDATED",
            previous_value=previous,
            new_value=serializer.data,
        )
        return Response(serializer.data)
