#!/usr/bin/env python3
"""Verificación de calidad y seguridad del repositorio.

Revisa tres cosas y falla (código 1) si encuentra algo:
  1. Archivos que nunca deben subirse (.pbix, datos, credenciales, .clasp.json).
  2. Datos sensibles en texto: identificaciones de 10 o 13 dígitos entre comillas
     (salvo ficticias permitidas), nombres de servidor y correos personales.
  3. Consultas SQL sin el nombre o el encabezado estándar.
  4. Enlaces relativos rotos en los archivos Markdown.
Uso: python3 .github/scripts/verificar.py
"""
import os, re, subprocess, sys

RAIZ = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
PROHIBIDOS = re.compile(r"(\.pbix|\.pbit|\.csv|\.xlsx|\.xls|\.bak|\.bson|\.pem|\.key|\.env)$|(^|/)\.clasp(rc)?\.json$|(^|/)(dump|backups)/", re.I)
MAX_MB = 50
# Identificaciones ficticias que se usan en ejemplos y datos de prueba.
FICTICIAS = {"0990000000001", "0912345678001", "0923456789001", "0934567890001", "0945678901001",
             "0956789012001", "0901234567890", "0967890123001", "0978901234001", "0989012345001",
             "0990123456001"}
ARCHIVOS_DE_PRUEBA = re.compile(r"(TestData|testHojaGestiones|PowerBITest)\.gs$")
PATRON_ID = re.compile(r"['\"](\d{13}|\d{10})['\"]")
PATRON_SERVIDOR = re.compile(r"SERVMUNI\w*|DATAWAREHOUSE", re.I)
PATRON_CORREO = re.compile(r"[\w.+-]+@(gmail|hotmail|outlook|yahoo)\.\w+", re.I)
TEXTO = (".md", ".sql", ".gs", ".html", ".json", ".py", ".yml", ".yaml", ".txt")

def archivos():
    out = subprocess.run(["git", "ls-files"], cwd=RAIZ, capture_output=True, text=True).stdout.split("\n")
    return [f for f in out if f]

def main():
    errores = []
    lista = archivos()
    for f in lista:
        ruta = os.path.join(RAIZ, f)
        if PROHIBIDOS.search(f):
            errores.append(f"Archivo prohibido en el repositorio: {f}")
            continue
        if os.path.exists(ruta) and os.path.getsize(ruta) > MAX_MB * 1024 * 1024:
            errores.append(f"Archivo de más de {MAX_MB} MB: {f}")
        if not f.lower().endswith(TEXTO) or f.startswith(".github/scripts/"):
            continue
        with open(ruta, encoding="utf-8", errors="ignore") as fh:
            for n, linea in enumerate(fh, 1):
                if PATRON_SERVIDOR.search(linea):
                    errores.append(f"{f}:{n}: nombre de servidor")
                if PATRON_CORREO.search(linea):
                    errores.append(f"{f}:{n}: correo personal")
                if ARCHIVOS_DE_PRUEBA.search(f):
                    continue
                for m in PATRON_ID.finditer(linea):
                    if m.group(1) not in FICTICIAS and not re.fullmatch(r"0+", m.group(1)) and set(m.group(1)) != {"9"}:
                        errores.append(f"{f}:{n}: posible RUC o cédula entre comillas")
    # Convención de las consultas SQL: nombre tema_vAAAAMM.sql y encabezado estándar
    for f in [x for x in lista if x.startswith("consultas/") and x.endswith(".sql") or "/consultas/" in x and x.endswith(".sql")]:
        nombre = os.path.basename(f)
        if nombre == "_plantilla.sql":
            continue
        if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*_v\d{6}\.sql", nombre):
            errores.append(f"{f}: el nombre debe ser tema-en-minusculas_vAAAAMM.sql")
        with open(os.path.join(RAIZ, f), encoding="utf-8", errors="ignore") as fh:
            cabecera = fh.read(3000)
        for campo in ("CONSULTA:", "Qué responde", "Bases de origen", "Granularidad", "Versión"):
            if campo not in cabecera:
                errores.append(f"{f}: falta «{campo}» en el encabezado")
    # Enlaces relativos en Markdown
    for f in [x for x in lista if x.endswith(".md")]:
        with open(os.path.join(RAIZ, f), encoding="utf-8") as fh:
            t = re.sub(r"```.*?```", "", fh.read(), flags=re.S)
        for m in re.finditer(r"\[[^\]]*\]\(([^)\s]+)\)", t):
            u = m.group(1)
            if u.startswith(("http", "mailto:", "#")):
                continue
            destino = os.path.normpath(os.path.join(RAIZ, os.path.dirname(f), u.split("#")[0]))
            if not os.path.exists(destino):
                errores.append(f"{f}: enlace roto a {u}")
    if errores:
        print("Se encontraron problemas:")
        for e in errores:
            print(" -", e)
        return 1
    print(f"Verificación correcta: {len(lista)} archivos revisados.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
