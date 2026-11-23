FROM python:3.11-slim

WORKDIR /app

# Install minimal system libraries for OpenCV and display
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Hugging Face Spaces defaults to port 7860; Render/Railway overrides PORT env var
ENV PORT=7860
EXPOSE 7860

CMD ["python", "server.py"]
