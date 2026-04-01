from django.http import JsonResponse
from django.contrib.auth import authenticate, login


# VULNERABILITY [A06]: No rate limiting on login endpoint - allows brute-force attacks.
# VULNERABILITY [A09]: No logging of failed authentication attempts.
def login_view(request):
    if request.method == "POST":
        username = request.POST.get("username", "")
        password = request.POST.get("password", "")

        # VULNERABILITY [A07]: Accepts default admin credentials.
        if username == "admin" and password == "admin":
            return JsonResponse({"status": "authenticated", "role": "admin"})

        user = authenticate(request, username=username, password=password)
        if user is not None:
            login(request, user)
            return JsonResponse({"status": "authenticated"})

        # VULNERABILITY [A09]: Failed login not logged anywhere.
        return JsonResponse({"status": "invalid_credentials"}, status=401)

    return JsonResponse({"error": "POST required"}, status=405)


# VULNERABILITY [A01]: No @login_required decorator - accessible without authentication.
def profile_view(request):
    user_id = request.GET.get("id", "")
    # Returns any user's profile without auth check
    return JsonResponse({"user_id": user_id, "profile": "sensitive_data"})


# VULNERABILITY [A01]: No @login_required decorator - user list exposed without auth.
def user_list_view(request):
    return JsonResponse({
        "users": [
            {"id": 1, "username": "admin", "email": "admin@example.com"},
            {"id": 2, "username": "user1", "email": "user1@example.com"},
        ]
    })
