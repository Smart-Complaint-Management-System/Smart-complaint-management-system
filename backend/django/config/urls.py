from django.contrib import admin
from django.urls import include, path
from django.conf import settings
from django.conf.urls.static import static
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from accounts.views import (
    AdminLoginView,
    LoginView,
    LogoutView,
    PasswordChangeView,
    ProfileView,
    RegistrationView,
)
from accounts.management_views import EmployeeViewSet, UserViewSet
from config.views import health_check
from departments.views import DepartmentViewSet
from complaints.views import (
    AdminComplaintAuditView,
    AdminComplaintDetailView,
    AdminComplaintDepartmentView,
    AdminComplaintListView,
    AdminComplaintPriorityView,
    AdminComplaintReopenView,
    AdminComplaintResolutionView,
    AdminComplaintStatusView,
    CategoryDepartmentMappingViewSet,
    ComplaintAttachmentView,
    ComplaintDetailView,
    ComplaintListCreateView,
    ComplaintUpdatesView,
    PriorityPolicyView,
    UnassignedComplaintListView,
)
from assignments.views import (
    AssignmentActionView,
    AssignmentDetailView,
    AssignmentEvidenceView,
    AssignmentListCreateView,
    MyAssignmentsView,
    WorkloadView,
)
from audit.views import AuditEventListView
from notifications.views import NotificationListView, NotificationReadAllView, NotificationReadView
from dashboard.views import DashboardSummaryView, EmployeeDashboardDetailView

router = DefaultRouter()
router.register("departments", DepartmentViewSet, basename="department")
router.register("users", UserViewSet, basename="user")
router.register("employees", EmployeeViewSet, basename="employee")
router.register("categories", CategoryDepartmentMappingViewSet, basename="category")


urlpatterns = [
    path("admin/", admin.site.urls),
    path("health/", health_check, name="health"),
    path("api/health/", health_check, name="api-health"),
    path("api/auth/register", RegistrationView.as_view(), name="auth-register"),
    path("api/auth/login", LoginView.as_view(), name="auth-login"),
    path("api/auth/logout", LogoutView.as_view(), name="auth-logout"),
    path("api/auth/me", ProfileView.as_view(), name="auth-profile"),
    path("api/auth/password", PasswordChangeView.as_view(), name="auth-password"),
    path("api/auth/token/refresh", TokenRefreshView.as_view(), name="token-refresh"),
    path("api/admin/login", AdminLoginView.as_view(), name="admin-login"),
    path("api/complaints", ComplaintListCreateView.as_view(), name="complaints"),
    path("api/complaints/<str:lookup>/updates", ComplaintUpdatesView.as_view(), name="complaint-updates"),
    path("api/complaints/<str:lookup>/attachments", ComplaintAttachmentView.as_view(), name="complaint-attachments"),
    path("api/complaints/<str:lookup>", ComplaintDetailView.as_view(), name="complaint-detail"),
    path("api/user/complaints", ComplaintListCreateView.as_view(), name="user-complaints"),
    path("api/user/complaints/<str:lookup>", ComplaintDetailView.as_view(), name="user-complaint-detail"),
    path("api/admin/complaints", AdminComplaintListView.as_view(), name="admin-complaints"),
    path("api/admin/complaints/unassigned", UnassignedComplaintListView.as_view(), name="unassigned-complaints"),
    path("api/admin/complaints/<str:lookup>/status", AdminComplaintStatusView.as_view(), name="admin-complaint-status"),
    path("api/admin/complaints/<str:lookup>/resolution", AdminComplaintResolutionView.as_view(), name="admin-complaint-resolution"),
    path("api/admin/complaints/<str:lookup>/audit-logs", AdminComplaintAuditView.as_view(), name="admin-complaint-audit"),
    path("api/admin/complaints/<str:lookup>/priority", AdminComplaintPriorityView.as_view(), name="admin-complaint-priority"),
    path("api/admin/complaints/<str:lookup>/department", AdminComplaintDepartmentView.as_view(), name="admin-complaint-department"),
    path("api/admin/complaints/<str:lookup>/reopen", AdminComplaintReopenView.as_view(), name="admin-complaint-reopen"),
    path("api/admin/complaints/<str:lookup>", AdminComplaintDetailView.as_view(), name="admin-complaint-detail"),
    path("api/priority-policy", PriorityPolicyView.as_view(), name="priority-policy"),
    path("api/assignments", AssignmentListCreateView.as_view(), name="assignments"),
    path("api/assignments/me", MyAssignmentsView.as_view(), name="my-assignments"),
    path("api/assignments/workload", WorkloadView.as_view(), name="assignment-workload"),
    path("api/assignments/<int:assignment_id>/evidence", AssignmentEvidenceView.as_view(), name="assignment-evidence"),
    path("api/assignments/<int:assignment_id>/<str:action>", AssignmentActionView.as_view(), name="assignment-action"),
    path("api/assignments/<int:assignment_id>", AssignmentDetailView.as_view(), name="assignment-detail"),
    path("api/audit-events", AuditEventListView.as_view(), name="audit-events"),
    path("api/notifications", NotificationListView.as_view(), name="notifications"),
    path("api/notifications/read-all", NotificationReadAllView.as_view(), name="notifications-read-all"),
    path("api/notifications/<int:notification_id>/read", NotificationReadView.as_view(), name="notification-read"),
    path("api/dashboard/summary", DashboardSummaryView.as_view(), name="dashboard-summary"),
    path("api/dashboard/employees/<int:employee_id>", EmployeeDashboardDetailView.as_view(), name="employee-dashboard-detail"),
    path("api/", include(router.urls)),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
