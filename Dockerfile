FROM node:22-slim AS frontend
WORKDIR /build
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.13-slim
WORKDIR /app
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend ./backend
COPY --from=frontend /build/dist ./frontend/dist
RUN useradd --create-home researcher && mkdir /app/data && chown researcher /app/data
USER researcher
ENV DATA_DIR=/app/data
EXPOSE 8000
# PORT is set by Render and most other hosts; it falls back to 8000 locally.
# deploy_app:app is app.main:app plus an optional password gate (set APP_PASSWORD).
# Keep ONE worker: the local Qdrant index lives inside the process (see README).
CMD ["sh", "-c", "exec uvicorn deploy_app:app --app-dir backend --host 0.0.0.0 --port ${PORT:-8000}"]
