FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && playwright install --with-deps chromium

RUN mkdir -p backend
COPY backend/__init__.py ./backend/__init__.py
COPY backend/vnexpress_service ./backend/vnexpress_service

EXPOSE 8020
CMD ["uvicorn", "backend.vnexpress_service.app.main:app", "--host", "0.0.0.0", "--port", "8020"]
