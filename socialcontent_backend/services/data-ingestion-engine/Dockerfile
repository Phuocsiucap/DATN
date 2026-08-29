FROM python:3.12-slim

WORKDIR /app
ENV PYTHONPATH=/app:/app/services/data-ingestion-engine
ENV PIP_DEFAULT_TIMEOUT=300 PIP_RETRIES=10 PIP_DISABLE_PIP_VERSION_CHECK=1

COPY socialcontent_backend/services/data-ingestion-engine/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --timeout 300 --retries 10 -r /app/requirements.txt

COPY socialcontent_backend/common /app/common
COPY socialcontent_backend/alembic.ini /app/alembic.ini
COPY socialcontent_backend/alembic /app/alembic
COPY socialcontent_backend/services/data-ingestion-engine/app /app/services/data-ingestion-engine/app

WORKDIR /app/services/data-ingestion-engine
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8010"]
