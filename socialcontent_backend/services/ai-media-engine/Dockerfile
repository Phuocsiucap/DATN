FROM python:3.12-slim

WORKDIR /app
ENV PYTHONPATH=/app:/app/services/ai-media-engine

RUN apt-get update \
    && apt-get install -y --no-install-recommends xauth \
    && rm -rf /var/lib/apt/lists/*

COPY socialcontent_backend/services/ai-media-engine/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt \
    && playwright install --with-deps chromium

COPY socialcontent_backend/common /app/common
COPY socialcontent_backend/alembic.ini /app/alembic.ini
COPY socialcontent_backend/alembic /app/alembic
COPY socialcontent_backend/services/ai-media-engine/app /app/services/ai-media-engine/app

WORKDIR /app/services/ai-media-engine
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8060"]
