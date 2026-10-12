// ============================================================
// SIGECO — Inicialización de MongoDB
// Se ejecuta automáticamente al crear el contenedor por primera vez
// ============================================================

// Nombre de la base con coma requiere comillas en JS
const DB_NAME = "Base1,5";

// Crear usuario de la aplicación con acceso readWrite
db = db.getSiblingDB(DB_NAME);

db.createUser({
  user: "sigeco_app",
  pwd:  process.env.MONGO_APP_PASS || "sigeco123",
  roles: [{ role: "readWrite", db: DB_NAME }]
});

// Usuario de solo lectura para reportes / Power BI
db.createUser({
  user: "sigeco_readonly",
  pwd:  process.env.MONGO_READONLY_PASS || "readonly123",
  roles: [{ role: "read", db: DB_NAME }]
});

print("✓ Usuarios MongoDB creados correctamente");
print("  sigeco_app      → readWrite en " + DB_NAME);
print("  sigeco_readonly → read      en " + DB_NAME);
print("⚠  Cambia las contraseñas en .env antes de producción!");
