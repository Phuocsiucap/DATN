FROM python:3.12-slim

WORKDIR /app
ENV PYTHONPATH=/app:/app/services/generate-video-service

RUN apt-get update \
    && apt-get install -y --no-install-recommends xauth \
    && rm -rf /var/lib/apt/lists/*

COPY socialcontent_backend/services/generate-video-service/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt \
    && playwright install --with-deps chromium

COPY socialcontent_backend/common /app/common
COPY socialcontent_backend/alembic.ini /app/alembic.ini
COPY socialcontent_backend/alembic /app/alembic
COPY socialcontent_backend/services/generate-video-service/app /app/services/generate-video-service/app

WORKDIR /app/services/generate-video-service
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8070"]
