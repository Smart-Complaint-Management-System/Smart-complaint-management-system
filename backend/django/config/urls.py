from django.contrib import admin
from django.urls import path

from config.views import health_check


urlpatterns = [
    path("admin/", admin.site.urls),
    path("health/", health_check, name="health"),
    path("api/health/", health_check, name="api-health"),
]
