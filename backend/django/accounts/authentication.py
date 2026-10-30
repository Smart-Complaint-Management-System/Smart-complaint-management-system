from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.authentication import JWTAuthentication


class VersionedJWTAuthentication(JWTAuthentication):
    """Reject access tokens issued before a user's most recent logout."""

    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        token_version = validated_token.get("token_version", 0)
        if token_version != user.token_version:
            raise AuthenticationFailed("This access token has been revoked.", code="token_not_valid")
        return user
