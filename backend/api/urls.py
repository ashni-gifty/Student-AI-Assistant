from django.urls import path
from . import views as v

urlpatterns = [
    path("auth/register/", v.register), path("auth/login/", v.login),
    path("auth/forgot/", v.forgot), path("auth/reset/", v.reset),
    path("documents/", v.documents), path("documents/<int:pk>/", v.document_detail),
    path("chats/", v.chats), path("chats/<int:pk>/", v.chat_detail),
    path("ask/", v.ask), path("summarize/", v.summarize),
    path("mcq/", v.mcq), path("agent/", v.agent_view),
    path("summaries/", v.summaries), path("summaries/<int:pk>/", v.summary_detail),
]
