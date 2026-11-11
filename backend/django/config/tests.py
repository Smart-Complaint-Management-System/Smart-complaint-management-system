from unittest.mock import patch

from django.db.utils import OperationalError
from django.test import SimpleTestCase
from rest_framework.test import APIClient


class HealthCheckTests(SimpleTestCase):
    def setUp(self):
        self.client = APIClient()

    @patch("config.views.connection.ensure_connection")
    def test_api_health_is_public_and_reports_database_ready(self, mock_db):
        response = self.client.get("/api/health/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {"status": "ok", "database": "ok"},
        )
        mock_db.assert_called_once()

    @patch("config.views.connection.ensure_connection")
    def test_health_reports_unavailable_when_database_fails(self, mock_db):
        mock_db.side_effect = OperationalError("Database unavailable")

        response = self.client.get("/api/health/")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(
            response.json(),
            {"status": "unavailable", "database": "unavailable"},
        )

    @patch("config.views.connection.ensure_connection")
    def test_legacy_health_path_is_available(self, mock_db):
        response = self.client.get("/health/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {"status": "ok", "database": "ok"},
        )
