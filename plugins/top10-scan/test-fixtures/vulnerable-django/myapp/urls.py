from django.contrib import admin
from django.urls import path

from . import views

urlpatterns = [
    path("admin/", admin.site.urls),
    path("login/", views.login_view, name="login"),
    path("profile/", views.profile_view, name="profile"),
    path("users/", views.user_list_view, name="user_list"),
]
