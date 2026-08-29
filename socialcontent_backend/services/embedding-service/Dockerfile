FROM python:3.12-slim

WORKDIR /app
ENV PYTHONPATH=/app:/app/services/embedding-service
ENV PIP_DEFAULT_TIMEOUT=300 PIP_RETRIES=10 PIP_DISABLE_PIP_VERSION_CHECK=1

COPY socialcontent_backend/services/embedding-service/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --timeout 300 --retries 10 -r /app/requirements.txt

COPY socialcontent_backend/common /app/common
COPY socialcontent_backend/services/embedding-service/app /app/services/embedding-service/app

WORKDIR /app/services/embedding-service
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8075"]
