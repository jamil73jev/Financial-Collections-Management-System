#!/bin/bash
# Crea el usuario de la aplicación SIGECO en la primera inicialización
# Este script solo corre la PRIMERA VEZ (cuando /data/db está vacío)

echo ">>> Inicializando usuario SIGECO en MongoDB..."

mongosh --eval "
db = db.getSiblingDB('admin');
db.createUser({
  user: 'sigeco_app',
  pwd: '${MONGO_APP_PASSWORD}',
  roles: [
    { role: 'readWrite', db: 'Thunder' },
    { role: 'dbAdmin', db: 'Thunder' }
  ]
});
print('Usuario sigeco_app creado correctamente.');
"

echo ">>> Inicialización completada."
