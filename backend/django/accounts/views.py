from django.db import transaction
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import AuthenticationFailed
from rest_framework_simplejwt.views import TokenObtainPairView

from accounts.roles import UserRole
from accounts.serializers import (
    EmailTokenObtainPairSerializer,
    PasswordChangeSerializer,
    ProfileSerializer,
    RegistrationSerializer,
    UserSummarySerializer,
)
from accounts.token_utils import issue_token_pair, revoke_user_tokens
from audit.services import log_event


def _record_login(response):
    if response.status_code == status.HTTP_200_OK and response.data.get("user", {}).get("id"):
        from accounts.models import User

        actor = User.objects.filter(pk=response.data["user"]["id"]).first()
        if actor:
            log_event(actor=actor, action="USER_LOGIN", new_value={"email": actor.email})


class RegistrationView(APIView):
    permission_classes = [AllowAny]

    @transaction.atomic
    def post(self, request):
        serializer = RegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        tokens = issue_token_pair(user)
        return Response(
            {**tokens, "token": tokens["access"], "user": UserSummarySerializer(user).data},
            status=status.HTTP_201_CREATED,
        )


class LoginView(TokenObtainPairView):
    permission_classes = [AllowAny]
    serializer_class = EmailTokenObtainPairSerializer

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        _record_login(response)
        return response


class AdminLoginView(LoginView):
    """Compatibility login route restricted to organization administrators."""

    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if serializer.user.role not in (UserRole.SUPER_ADMIN, UserRole.DEPARTMENT_ADMIN):
            raise AuthenticationFailed("Administrator access is required.")
        response = Response(serializer.validated_data, status=status.HTTP_200_OK)
        _record_login(response)
        return response


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        log_event(actor=request.user, action="USER_LOGOUT", new_value={"email": request.user.email})
        revoke_user_tokens(request.user)
        return Response({"detail": "Logged out."}, status=status.HTTP_200_OK)


class ProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(ProfileSerializer(request.user).data)

    def patch(self, request):
        serializer = ProfileSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class PasswordChangeView(APIView):
    permission_classes = [IsAuthenticated]

    @transaction.atomic
    def post(self, request):
        serializer = PasswordChangeSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        revoke_user_tokens(user)
        return Response({"detail": "Password updated. Sign in again to continue."})
