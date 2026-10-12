"""
SIGECO — Módulo de Autenticación
=================================
JWT + bcrypt + Roles

Roles disponibles:
    ADMINISTRADOR  → acceso total, gestión de usuarios
    SUPERVISOR     → lectura total + editar notificaciones + ver auditoría
    GESTOR         → crear/editar notificaciones asignadas a sí mismo
    AUDITOR        → solo lectura de todos los módulos

Variables de entorno requeridas:
    JWT_SECRET      → clave secreta para firmar tokens (mín. 32 chars)
    JWT_ALGORITHM   → default HS256
    JWT_EXPIRE_HOURS → default 8
"""

import os
from datetime import datetime, timedelta
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, status, Body
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jose import JWTError, jwt
from passlib.context import CryptContext
from motor.motor_asyncio import AsyncIOMotorClient

# ── Configuración ─────────────────────────────────────────────────────────────
JWT_SECRET       = os.getenv("JWT_SECRET",       "CAMBIA_ESTE_SECRETO_EN_PRODUCCION_min32chars!")
JWT_ALGORITHM    = os.getenv("JWT_ALGORITHM",    "HS256")
JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "8"))

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME   = os.getenv("DB_NAME",   "Thunder")

# ── Constantes de roles ────────────────────────────────────────────────────────
ROLES = ["ADMINISTRADOR", "SUPERVISOR", "GESTOR", "AUDITOR"]

PERMISOS = {
    # Formato: endpoint_tag → roles con acceso
    "dashboard":       ["ADMINISTRADOR", "SUPERVISOR", "GESTOR", "AUDITOR"],
    "contribuyentes":  ["ADMINISTRADOR", "SUPERVISOR", "GESTOR", "AUDITOR"],
    "notificaciones":  ["ADMINISTRADOR", "SUPERVISOR", "GESTOR"],
    "empleados":       ["ADMINISTRADOR", "SUPERVISOR"],
    "recaudacion":     ["ADMINISTRADOR", "SUPERVISOR", "AUDITOR"],
    "morosidad":       ["ADMINISTRADOR", "SUPERVISOR", "GESTOR", "AUDITOR"],
    "auditoria":       ["ADMINISTRADOR", "SUPERVISOR", "AUDITOR"],
    "usuarios":        ["ADMINISTRADOR"],
}

# ── Utilidades ────────────────────────────────────────────────────────────────
pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

router = APIRouter(prefix="/api/auth", tags=["Autenticación"])


def _get_db():
    client = AsyncIOMotorClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    return client[DB_NAME]


def hash_password(plain: str) -> str:
    return pwd_ctx.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_ctx.verify(plain, hashed)


def create_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    payload = data.copy()
    expire  = datetime.utcnow() + (expires_delta or timedelta(hours=JWT_EXPIRE_HOURS))
    payload.update({"exp": expire, "iat": datetime.utcnow()})
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _user_to_dict(doc: dict) -> dict:
    """Convierte documento MongoDB de usuario a dict limpio (sin passwordHash)."""
    return {
        "_id":          str(doc["_id"]),
        "username":     doc.get("username", ""),
        "nombre":       doc.get("nombre", ""),
        "email":        doc.get("email", ""),
        "cargo":        doc.get("cargo", ""),
        "role":         doc.get("role", "GESTOR"),
        "activo":       doc.get("activo", True),
        "ultimoAcceso": doc.get("ultimoAcceso", ""),
    }


# ── Dependencia: usuario autenticado ─────────────────────────────────────────
async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    """Decodifica el JWT y retorna el usuario. Lanza 401 si es inválido."""
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token inválido o expirado",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        username: str = payload.get("sub")
        if not username:
            raise credentials_exc
    except JWTError:
        raise credentials_exc

    db   = _get_db()
    # Excluir passwordHash: no se necesita en requests autenticados (solo en login)
    user = await db["usuarios"].find_one(
        {"username": username, "activo": True},
        {"passwordHash": 0}
    )
    if not user:
        raise credentials_exc

    # Actualizar último acceso (sin bloquear la respuesta)
    await db["usuarios"].update_one(
        {"_id": user["_id"]},
        {"$set": {"ultimoAcceso": datetime.utcnow().isoformat()}}
    )
    return _user_to_dict(user)


def require_roles(*roles: str):
    """
    Dependencia factory — protege un endpoint a ciertos roles.
    Uso: Depends(require_roles("ADMINISTRADOR", "SUPERVISOR"))
    """
    async def _check(current_user: dict = Depends(get_current_user)):
        if current_user["role"] not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Acceso denegado. Roles requeridos: {list(roles)}",
            )
        return current_user
    return _check


# Shortcuts por grupo de permiso
require_admin      = require_roles("ADMINISTRADOR")
require_supervisor = require_roles("ADMINISTRADOR", "SUPERVISOR")
require_gestor     = require_roles("ADMINISTRADOR", "SUPERVISOR", "GESTOR")
require_any        = require_roles("ADMINISTRADOR", "SUPERVISOR", "GESTOR", "AUDITOR")


# ── Endpoints de autenticación ────────────────────────────────────────────────

@router.post("/login", summary="Iniciar sesión")
async def login(form: OAuth2PasswordRequestForm = Depends()):
    """
    Autentica al usuario con username + password.
    Retorna access_token JWT válido por JWT_EXPIRE_HOURS horas.
    """
    db   = _get_db()
    user = await db["usuarios"].find_one({"username": form.username})

    if not user or not user.get("activo", False):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas o usuario inactivo",
        )
    if not verify_password(form.password, user.get("passwordHash", "")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Credenciales incorrectas o usuario inactivo",
        )

    token = create_token({"sub": user["username"], "role": user["role"]})

    return {
        "access_token": token,
        "token_type":   "bearer",
        "expires_in":   JWT_EXPIRE_HOURS * 3600,
        "user": _user_to_dict(user),
    }


@router.get("/me", summary="Perfil del usuario autenticado")
async def get_me(current_user: dict = Depends(get_current_user)):
    """Retorna los datos del usuario que hace la solicitud."""
    return current_user


@router.post("/logout", summary="Cerrar sesión")
async def logout(current_user: dict = Depends(get_current_user)):
    """
    Marca el cierre de sesión en auditoría.
    (Los tokens JWT son stateless — el cliente debe eliminar el token local.)
    """
    db = _get_db()
    await db["auditoria"].insert_one({
        "tipo":      "Logout",
        "entidad":   "usuario",
        "entidadId": current_user["_id"],
        "detalle":   f"Cierre de sesión: {current_user['username']}",
        "usuario":   current_user["username"],
        "fecha":     datetime.utcnow().isoformat(),
    })
    return {"message": "Sesión cerrada correctamente"}


# ── Gestión de usuarios (solo ADMINISTRADOR) ──────────────────────────────────

@router.get("/usuarios", summary="Listar usuarios")
async def list_users(current_user: dict = Depends(require_admin)):
    db   = _get_db()
    cursor = db["usuarios"].find({}, {"passwordHash": 0})
    docs = await cursor.to_list(100)
    return {"data": [_user_to_dict(d) for d in docs]}


@router.post("/usuarios", summary="Crear usuario")
async def create_user(payload: dict = Body(...), current_user: dict = Depends(require_admin)):
    """
    Crea un nuevo usuario del sistema.
    Body: { username, password, nombre, email, cargo, role }
    """
    db = _get_db()

    required = ["username", "password", "nombre", "role"]
    for field in required:
        if not payload.get(field):
            raise HTTPException(400, f"Campo requerido: {field}")

    if payload["role"] not in ROLES:
        raise HTTPException(400, f"Rol inválido. Opciones: {ROLES}")

    if await db["usuarios"].find_one({"username": payload["username"]}):
        raise HTTPException(409, "El username ya existe")

    nuevo = {
        "username":     payload["username"].strip().lower(),
        "nombre":       payload["nombre"],
        "email":        payload.get("email", ""),
        "cargo":        payload.get("cargo", ""),
        "role":         payload["role"],
        "activo":       True,
        "passwordHash": hash_password(payload["password"]),
        "fechaCreacion": datetime.utcnow().isoformat(),
        "creadoPor":    current_user["username"],
    }
    result = await db["usuarios"].insert_one(nuevo)
    uid = str(result.inserted_id)

    await db["auditoria"].insert_one({
        "tipo":      "Creación",
        "entidad":   "usuario",
        "entidadId": uid,
        "detalle":   f"Usuario creado: {nuevo['username']} (rol: {nuevo['role']})",
        "usuario":   current_user["username"],
        "fecha":     datetime.utcnow().isoformat(),
    })
    return {"id": uid, "message": "Usuario creado correctamente"}


@router.put("/usuarios/{uid}", summary="Editar usuario")
async def update_user(uid: str, payload: dict = Body(...), current_user: dict = Depends(require_admin)):
    """Actualiza datos de un usuario (excepto contraseña)."""
    db = _get_db()
    try:
        oid = ObjectId(uid)
    except Exception:
        raise HTTPException(400, "ID inválido")

    payload.pop("_id", None)
    payload.pop("passwordHash", None)  # No se permite cambiar hash directo

    if "role" in payload and payload["role"] not in ROLES:
        raise HTTPException(400, f"Rol inválido. Opciones: {ROLES}")

    payload["_modificado"]   = datetime.utcnow().isoformat()
    payload["modificadoPor"] = current_user["username"]

    result = await db["usuarios"].update_one({"_id": oid}, {"$set": payload})
    if result.matched_count == 0:
        raise HTTPException(404, "Usuario no encontrado")

    await db["auditoria"].insert_one({
        "tipo":      "Edición",
        "entidad":   "usuario",
        "entidadId": uid,
        "detalle":   f"Usuario editado: campos {list(payload.keys())}",
        "usuario":   current_user["username"],
        "fecha":     datetime.utcnow().isoformat(),
    })
    return {"message": "Usuario actualizado"}


@router.put("/usuarios/{uid}/password", summary="Cambiar contraseña")
async def change_password(uid: str, payload: dict = Body(...), current_user: dict = Depends(get_current_user)):
    """
    Cambia la contraseña de un usuario.
    Un ADMINISTRADOR puede cambiar la de cualquiera.
    Un usuario solo puede cambiar la suya propia.
    """
    db = _get_db()
    try:
        oid = ObjectId(uid)
    except Exception:
        raise HTTPException(400, "ID inválido")

    # Verificar permisos
    target = await db["usuarios"].find_one({"_id": oid})
    if not target:
        raise HTTPException(404, "Usuario no encontrado")

    is_self  = str(target["_id"]) == current_user["_id"]
    is_admin = current_user["role"] == "ADMINISTRADOR"

    if not is_self and not is_admin:
        raise HTTPException(403, "No tienes permiso para cambiar esta contraseña")

    new_pass = payload.get("password", "").strip()
    if len(new_pass) < 6:
        raise HTTPException(400, "La contraseña debe tener al menos 6 caracteres")

    await db["usuarios"].update_one(
        {"_id": oid},
        {"$set": {
            "passwordHash":        hash_password(new_pass),
            "_passwordCambiado":   datetime.utcnow().isoformat(),
            "cambiadoPor":         current_user["username"],
        }}
    )
    return {"message": "Contraseña actualizada"}


@router.delete("/usuarios/{uid}", summary="Desactivar usuario")
async def deactivate_user(uid: str, current_user: dict = Depends(require_admin)):
    """Desactiva un usuario (soft delete — no elimina el registro)."""
    db = _get_db()
    try:
        oid = ObjectId(uid)
    except Exception:
        raise HTTPException(400, "ID inválido")

    if uid == current_user["_id"]:
        raise HTTPException(400, "No puedes desactivar tu propio usuario")

    result = await db["usuarios"].update_one(
        {"_id": oid},
        {"$set": {"activo": False, "_desactivado": datetime.utcnow().isoformat()}}
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Usuario no encontrado")

    await db["auditoria"].insert_one({
        "tipo":      "Desactivación",
        "entidad":   "usuario",
        "entidadId": uid,
        "detalle":   "Usuario desactivado",
        "usuario":   current_user["username"],
        "fecha":     datetime.utcnow().isoformat(),
    })
    return {"message": "Usuario desactivado"}
