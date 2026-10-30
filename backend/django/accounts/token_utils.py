from django.utils import timezone
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken


def issue_token_pair(user):
    refresh = RefreshToken.for_user(user)
    refresh["token_version"] = user.token_version
    return {
        "refresh": str(refresh),
        "access": str(refresh.access_token),
    }


def revoke_user_tokens(user):
    user.token_version += 1
    user.save(update_fields=["token_version"])

    outstanding_tokens = OutstandingToken.objects.filter(
        user=user,
        expires_at__gt=timezone.now(),
    )
    for outstanding_token in outstanding_tokens.iterator():
        BlacklistedToken.objects.get_or_create(token=outstanding_token)
