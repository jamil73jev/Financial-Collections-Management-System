FROM mongo:7.0

# Copiar configuración personalizada de MongoDB
COPY mongod.conf /etc/mongod.conf.d/sigeco.conf

# Script de inicialización: crea usuario admin en primer arranque
COPY init-mongo.sh /docker-entrypoint-initdb.d/init-mongo.sh
RUN chmod +x /docker-entrypoint-initdb.d/init-mongo.sh
