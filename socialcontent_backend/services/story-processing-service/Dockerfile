FROM python:3.12-slim

WORKDIR /app
ENV PYTHONPATH=/app:/app/services/story-processing-service

COPY socialcontent_backend/services/story-processing-service/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY socialcontent_backend/common /app/common
COPY socialcontent_backend/services/story-processing-service/app /app/services/story-processing-service/app

WORKDIR /app/services/story-processing-service
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8040"]
