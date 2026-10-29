import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")  # reads backend/.env if it exists
SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-change-me")
DEBUG = os.getenv("DEBUG", "true").lower() == "true"
ALLOWED_HOSTS = os.getenv("ALLOWED_HOSTS", "*").split(",")
if not DEBUG and SECRET_KEY == "dev-only-change-me":
    raise RuntimeError("Set a real SECRET_KEY in the server settings.")
DATA_DIR = Path(os.getenv("DATA_DIR", BASE_DIR))   # point this at a persistent disk when hosting

INSTALLED_APPS = [
    "django.contrib.auth", "django.contrib.contenttypes", "django.contrib.staticfiles",
    "corsheaders", "rest_framework", "rest_framework.authtoken", "api",
]
MIDDLEWARE = ["corsheaders.middleware.CorsMiddleware", "django.middleware.common.CommonMiddleware"]
ROOT_URLCONF = "config.urls"
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": DATA_DIR / "db.sqlite3"}}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
STATIC_URL = "/static/"
MEDIA_URL = "/media/"
MEDIA_ROOT = DATA_DIR / "media"
_origins = os.getenv("CORS_ORIGINS", "")
if _origins:
    CORS_ALLOWED_ORIGINS = [o.strip() for o in _origins.split(",")]
else:
    CORS_ALLOW_ALL_ORIGINS = True


EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"  # reset codes print in the terminal
if os.getenv("EMAIL_HOST_USER"):
    EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend"
    EMAIL_HOST = "smtp.gmail.com"
    EMAIL_PORT = 587
    EMAIL_USE_TLS = True
    EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER")
    EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD")
    DEFAULT_FROM_EMAIL = EMAIL_HOST_USER

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.TokenAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
}

# AI and cost controls
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "gpt-6-luna")
AGENT_MODEL = os.getenv("AGENT_MODEL", "gpt-6-luna")   # must support function calling
CHROMA_DIR = DATA_DIR / "chroma"
MAX_CHUNK_CHARS = 1200     # each retrieved chunk is trimmed to this
MAX_PROMPT_CHARS = 14000   # hard cap on anything sent to the LLM
RELEVANCE_MAX = 0.75       # cosine distance above this means "not in the notes"      # cosine distance above this means "not in the notes"
