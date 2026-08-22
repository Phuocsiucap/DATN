FROM python:3.12-slim

WORKDIR /app
ENV PYTHONPATH=/app:/app/services/data-ingestion-engine

COPY socialcontent_backend/services/data-ingestion-engine/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY socialcontent_backend/common /app/common
COPY socialcontent_backend/alembic.ini /app/alembic.ini
COPY socialcontent_backend/alembic /app/alembic
COPY socialcontent_backend/services/data-ingestion-engine/app /app/services/data-ingestion-engine/app

WORKDIR /app/services/data-ingestion-engine
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8010"]
