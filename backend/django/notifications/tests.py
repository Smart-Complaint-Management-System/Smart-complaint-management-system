from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User
from notifications.models import Notification


class NotificationAccessTests(TestCase):
    def test_notifications_are_visible_only_to_the_recipient(self):
        actor = User.objects.create_user("notify-actor@example.com", name="Actor", password="Testing-passphrase!19384")
        first = User.objects.create_user("notify-first@example.com", name="First", password="Testing-passphrase!19384")
        second = User.objects.create_user("notify-second@example.com", name="Second", password="Testing-passphrase!19384")
        notice = Notification.objects.create(recipient=first, actor=actor, kind="TEST", title="Private", message="First only")
        client = APIClient()
        client.force_authenticate(first)
        self.assertEqual(client.get("/api/notifications").data["count"], 1)
        self.assertEqual(client.post(f"/api/notifications/{notice.pk}/read").status_code, 200)
        client.force_authenticate(second)
        self.assertEqual(client.get("/api/notifications").data["count"], 0)
        self.assertEqual(client.post(f"/api/notifications/{notice.pk}/read").status_code, 404)
