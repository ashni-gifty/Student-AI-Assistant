from django.contrib.auth.models import User
from django.db import models


class Document(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    name = models.CharField(max_length=255)
    file = models.FileField(upload_to="docs/")
    size = models.BigIntegerField(default=0)
    created = models.DateTimeField(auto_now_add=True)


class Chunk(models.Model):
    """Text pieces of a document. Embeddings live in ChromaDB, text and headings live here."""
    document = models.ForeignKey(Document, on_delete=models.CASCADE)
    page = models.IntegerField()
    idx = models.IntegerField()
    heading = models.CharField(max_length=200)
    text = models.TextField()


class Chat(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    document = models.ForeignKey(Document, null=True, blank=True, on_delete=models.SET_NULL)
    title = models.CharField(max_length=120)
    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)


class Message(models.Model):
    chat = models.ForeignKey(Chat, related_name="messages", on_delete=models.CASCADE)
    role = models.CharField(max_length=10)
    content = models.TextField()
    meta = models.JSONField(default=dict, blank=True)
    created = models.DateTimeField(auto_now_add=True)

class Summary(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    document = models.ForeignKey(Document, null=True, blank=True, on_delete=models.SET_NULL)
    doc_name = models.CharField(max_length=255)
    text = models.TextField()
    created = models.DateTimeField(auto_now_add=True)