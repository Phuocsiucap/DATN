FROM python:3.12-slim

WORKDIR /app
ENV PYTHONPATH=/app:/app/services/ai-media-engine
ENV PIP_DEFAULT_TIMEOUT=300 PIP_RETRIES=10 PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        libgl1 \
        libglib2.0-0 \
        libsm6 \
        libxext6 \
        libxrender1 \
        libxcb1 \
    && rm -rf /var/lib/apt/lists/*

COPY socialcontent_backend/services/ai-media-engine/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --timeout 300 --retries 10 -r /app/requirements.txt

COPY socialcontent_backend/common /app/common
COPY socialcontent_backend/alembic.ini /app/alembic.ini
COPY socialcontent_backend/alembic /app/alembic
COPY socialcontent_backend/services/ai-media-engine/app /app/services/ai-media-engine/app

WORKDIR /app/services/ai-media-engine
CMD ["uvicorn", "app.planning.main:app", "--host", "0.0.0.0", "--port", "8050"]
