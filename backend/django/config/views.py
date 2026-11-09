from django.db import connection, DatabaseError
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response


@api_view(["GET"])
@permission_classes([AllowAny])
def health_check(_request):
    try:
        connection.ensure_connection()
    except DatabaseError:
        return Response(
            {"status": "unavailable", "database": "unavailable"},
            status=503,
        )

    return Response({"status": "ok", "database": "ok"})
