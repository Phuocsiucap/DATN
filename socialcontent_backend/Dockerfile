FROM python:3.12-slim

WORKDIR /app
ENV PYTHONPATH=/app

RUN apt-get update \
    && apt-get install -y --no-install-recommends xauth \
    && rm -rf /var/lib/apt/lists/*

COPY socialcontent_backend/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt \
    && playwright install --with-deps chromium

COPY socialcontent_backend /app

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
