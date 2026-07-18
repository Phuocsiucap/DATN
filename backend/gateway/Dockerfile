FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN mkdir -p backend
COPY backend/__init__.py ./backend/__init__.py
COPY backend/gateway ./backend/gateway

EXPOSE 8000
CMD ["uvicorn", "backend.gateway.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
