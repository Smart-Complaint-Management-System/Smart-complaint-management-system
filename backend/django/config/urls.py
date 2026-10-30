from django.contrib import admin
from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from accounts.views import (
    AdminLoginView,
    LoginView,
    LogoutView,
    PasswordChangeView,
    ProfileView,
    RegistrationView,
)
from config.views import health_check


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
]
