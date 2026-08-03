FROM python:3.12-slim

WORKDIR /app
ENV PYTHONPATH=/app:/app/services/crawler-service

COPY socialcontent_backend/services/crawler-service/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY socialcontent_backend/common /app/common
COPY socialcontent_backend/services/crawler-service/app /app/services/crawler-service/app

WORKDIR /app/services/crawler-service
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8020"]
