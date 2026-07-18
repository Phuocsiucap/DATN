FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN mkdir -p backend
COPY backend/__init__.py ./backend/__init__.py
COPY backend/bilibili_service ./backend/bilibili_service

EXPOSE 8010
CMD ["uvicorn", "backend.bilibili_service.app.main:app", "--host", "0.0.0.0", "--port", "8010"]
