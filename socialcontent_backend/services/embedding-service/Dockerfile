FROM python:3.12-slim

WORKDIR /app

ARG PRELOAD_FASTEMBED=true
ARG FASTEMBED_MODEL_NAME=intfloat/multilingual-e5-large

COPY socialcontent_backend/services/embedding-service/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

RUN if [ "$PRELOAD_FASTEMBED" = "true" ]; then \
      python -c "from fastembed import TextEmbedding; model=TextEmbedding(model_name='$FASTEMBED_MODEL_NAME', threads=2); list(model.embed(['query: warmup'])); print('fastembed model cached:', '$FASTEMBED_MODEL_NAME')" ; \
    fi

COPY socialcontent_backend/services/embedding-service/app /app/app

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8060"]
