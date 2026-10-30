from django.db.models import Q
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.roles import UserRole, department_for_user, has_role
from audit.models import AuditEvent
from audit.serializers import AuditEventSerializer


class AuditEventListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        queryset = AuditEvent.objects.select_related("actor", "department", "complaint")
        if has_role(request.user, UserRole.SUPER_ADMIN):
            pass
        elif has_role(request.user, UserRole.DEPARTMENT_ADMIN):
            department = department_for_user(request.user)
            queryset = queryset.filter(department=department) if department else queryset.none()
        elif has_role(request.user, UserRole.EMPLOYEE):
            queryset = queryset.filter(
                Q(actor=request.user)
                | Q(complaint__assigned_employee=request.user)
                | Q(complaint__assignments__employee=request.user)
            ).distinct()
        elif has_role(request.user, UserRole.USER):
            queryset = queryset.filter(complaint__submitted_by=request.user)
        else:
            raise PermissionDenied("Audit records are not available to this account.")
        complaint_id = request.query_params.get("complaint")
        if complaint_id:
            queryset = queryset.filter(complaint__complaint_id=complaint_id)
        action = request.query_params.get("action")
        if action:
            queryset = queryset.filter(action=action)
        data = AuditEventSerializer(queryset, many=True).data
        return Response({"count": len(data), "audit_events": data})
