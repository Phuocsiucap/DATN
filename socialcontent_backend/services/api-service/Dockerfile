FROM python:3.12-slim

WORKDIR /app
ENV PYTHONPATH=/app:/app/services/api-service

COPY socialcontent_backend/services/api-service/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY socialcontent_backend/common /app/common
COPY socialcontent_backend/alembic.ini /app/alembic.ini
COPY socialcontent_backend/alembic /app/alembic
COPY socialcontent_backend/services/api-service/app /app/services/api-service/app

WORKDIR /app/services/api-service
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
