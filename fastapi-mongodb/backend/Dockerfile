FROM python:3.11-slim

WORKDIR /app

# Instalar dependencias del sistema mínimas
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copiar e instalar dependencias Python primero (cache de layers)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código fuente
COPY . .

# Crear directorio de logs
RUN mkdir -p logs

# Usuario no-root por seguridad
RUN adduser --disabled-password --gecos "" sigeco
RUN chown -R sigeco:sigeco /app
USER sigeco

EXPOSE 8000

CMD ["python", "main.py"]
