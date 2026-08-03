FROM python:3.12-slim

WORKDIR /app
ENV PYTHONPATH=/app:/app/services/planning-orchestrator

COPY socialcontent_backend/services/planning-orchestrator/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY socialcontent_backend/common /app/common
COPY socialcontent_backend/services/planning-orchestrator/app /app/services/planning-orchestrator/app

WORKDIR /app/services/planning-orchestrator
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8050"]
