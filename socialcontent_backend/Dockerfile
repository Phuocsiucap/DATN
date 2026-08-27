FROM python:3.12-slim

WORKDIR /app
ENV PYTHONPATH=/app

COPY socialcontent_backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY socialcontent_backend /app

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
