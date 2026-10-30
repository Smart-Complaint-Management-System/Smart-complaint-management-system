from django.db import models


class Department(models.Model):
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    identifier = models.SlugField(max_length=32, unique=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name", "id"]

    def __str__(self):
        return self.name
