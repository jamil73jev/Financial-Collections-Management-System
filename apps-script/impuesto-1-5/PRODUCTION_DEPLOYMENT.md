# SIGECO MVP v2.0 — Production Deployment Guide

**Date:** March 2026
**System:** SIGECO (Sistema de Seguimiento Recaudatorio Institucional)
**Version:** 2.0 (Institutional Redesign)
**Deployment Type:** Google Apps Script Web App

---

## 1. Deployment Architecture Overview

### System Components

```
┌─────────────────────────────────────────────────────────┐
│  Google Apps Script Web App (doGet + Index.html)         │
├─────────────────────────────────────────────────────────┤
│  Frontend (SPA):                                          │
│  - Login, Dashboard, Expedientes, Gestiones             │
│  - Seguimiento, Bitácora, Importar, Usuarios            │
│  - Bootstrap 5.3 + Chart.js                             │
├─────────────────────────────────────────────────────────┤
│  Backend (18 Service Modules):                           │
│  - Auth, Constants, Setup, SecurityService              │
│  - ExpedienteService, GestionService, ValidationService │
│  - BitacoraService, AlertService, DashboardService      │
│  - ImportService, IntegrityService, etc.                │
├─────────────────────────────────────────────────────────┤
│  Data Layer:                                             │
│  - Google Sheet: 8 sheets (CONFIG, USUARIOS,             │
│    CONTRIBUYENTES, EXPEDIENTES, GESTIONES,              │
│    SEGUIMIENTO, BITACORA, DASHBOARD)                    │
└─────────────────────────────────────────────────────────┘
```

### Deployment Phases

1. **Pre-Deployment (This Document)** — Checklist, security review
2. **Setup Phase** — Database initialization, user creation
3. **Testing Phase** — Integration testing, load testing
4. **Production Deploy** — Apps Script deployment, domain binding
5. **Post-Deploy** — Health checks, monitoring, alerting

---

## 2. Pre-Deployment Checklist

### 2.1 Code Review & Quality Assurance

- [ ] All 18 service modules reviewed for security issues
- [ ] No hardcoded credentials, API keys, or secrets in code
- [ ] All database operations use SheetService (no direct API calls)
- [ ] Input validation enforced in ValidationService
- [ ] Error handling in all try-catch blocks
- [ ] Logging strategy verified (BitacoraService appends logs correctly)

### 2.2 Security Hardening

- [ ] SPREADSHEET_ID stored in PropertiesService (not in code)
- [ ] Admin password changed from default (Admin2024!)
- [ ] All users have strong passwords (minimum 12 chars, mixed case, numbers)
- [ ] API endpoints require token authentication (checkAccess validation)
- [ ] Role-based access control tested for all operations
- [ ] No SQL injection / XSS / CSV injection vulnerabilities
- [ ] CORS policies appropriate (App Script web app = "Anyone")
- [ ] Session timeout = 8 hours (configurable in PARAMS)

### 2.3 Database Setup

- [ ] Dedicated Google Sheet created for production
- [ ] SPREADSHEET_ID recorded and secured
- [ ] All 8 sheets created (via setupSystem())
- [ ] Headers written with correct formatting
- [ ] Filter rows frozen and activated on all sheets
- [ ] CONFIG sheet initialized with defaults
- [ ] Admin user created with secure password
- [ ] Backup sheet created (if using BackupService)

### 2.4 Performance & Limits

- [ ] Page size for pagination = 50 (adjustable in Constants)
- [ ] Batch operations implemented (no cell-by-cell writes)
- [ ] Dashboard KPIs calculated at runtime (not pre-stored)
- [ ] Alert checks scheduled for off-peak times (7am daily)
- [ ] No infinite loops or recursive calls
- [ ] Timeouts configured for long-running operations

### 2.5 Monitoring & Logging

- [ ] BitacoraService verified (immutable append-only)
- [ ] All user actions logged (create, update, delete, login)
- [ ] Error stack traces captured for debugging
- [ ] Performance metrics collected (query times, API calls)
- [ ] Alert thresholds configured (days_without_movement, etc.)

---

## 3. Database Setup & Initialization

### 3.1 Create Production Google Sheet

**Steps:**
1. Go to [Google Drive](https://drive.google.com)
2. Click **New** → **Google Sheets** → **Blank spreadsheet**
3. Name it: `SIGECO_PRODUCCION_2026` (or equivalent)
4. Get the Sheet ID from the URL:
   ```
   https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit
   ```

### 3.2 Configure Apps Script to Use Production Sheet

**In Apps Script Editor:**
1. Open the SIGECO Apps Script project
2. Go to **Project Settings**
3. Under "Script Properties", add or update:
   - Key: `SPREADSHEET_ID`
   - Value: (paste the SHEET_ID from above)
4. Save

### 3.3 Run setupSystem()

**In Apps Script Editor:**
1. Open **Code.gs**
2. Select function dropdown → `setupSystem`
3. Click **Run** button
4. Check Logger output for success messages
5. Verify all 8 sheets created in Google Sheet

**Expected Log Output:**
```
=== INICIANDO setupSystem() ===
Hoja creada: CONFIG
Hoja creada: USUARIOS
Hoja creada: CONTRIBUYENTES
Hoja creada: EXPEDIENTES
Hoja creada: GESTIONES
Hoja creada: SEGUIMIENTO
Hoja creada: BITACORA
Hoja creada: DASHBOARD
Encabezados escritos: CONFIG
[... more encabezados ...]
CONFIG: N valores cargados.
Usuario admin creado: admin@municipio.gob.ec
Spreadsheet ID almacenado: {SHEET_ID}
=== setupSystem() COMPLETADO ===
```

### 3.4 Create Initial Users (via Usuarios Admin Page or API)

After deploying the app, login as admin and create institutional users:

**Required Users:**
- 1-2 SUPERVISOR roles (overseers)
- 3-5 GESTOR roles (case managers)
- 1 AUDITOR role (audit reviewer)
- Additional ADMINs if needed

---

## 4. Security Hardening

### 4.1 Authentication & Passwords

**Admin Password Change (CRITICAL):**
1. Login with default credentials: `admin@municipio.gob.ec` / `Admin2024!`
2. Navigate to **Usuarios** page (Admin only)
3. Change admin password immediately
4. Require password change for all new users on first login (future feature)

**Password Policy:**
- Minimum 12 characters
- Must include: uppercase, lowercase, numbers, special characters
- No common words or dictionary terms
- Change every 90 days (recommend in CONFIG)

### 4.2 Role-Based Access Control (RBAC)

**Permission Matrix (enforced in SecurityService):**

| Permission | ADMIN | SUPERVISOR | GESTOR | AUDITOR |
|---|---|---|---|---|
| create_expediente | ✓ | ✓ | ✓ | ✗ |
| update_expediente | ✓ | ✓ | Own only | ✗ |
| view_expediente_all | ✓ | ✓ | ✗ | ✓ |
| register_gestion | ✓ | ✓ | ✓ | ✗ |
| view_seguimiento | ✓ | ✓ | ✗ | ✓ |
| view_bitacora | ✓ | ✗ | ✗ | ✓ |
| import_csv | ✓ | ✗ | ✗ | ✗ |
| manage_users | ✓ | ✗ | ✗ | ✗ |
| modify_config | ✓ | ✗ | ✗ | ✗ |

**Enforcement Points:**
- Every API call validated in dispatcher (Code.gs)
- requireRole() or checkAccess() called before operation
- All validations logged to BITACORA

### 4.3 Data Encryption (Future Enhancement)

**Current:** Passwords hashed with SHA-256 + salt
**Recommended for v2.1:**
- Enable Google Sheet encryption at rest
- Use Google Drive's built-in encryption
- Consider app-level encryption for sensitive fields (RUC, taxpayer names)

### 4.4 Backup & Disaster Recovery

**Automated Backups:**
- BackupService.gs creates daily backups (copy of all sheets)
- Stored in same Google Drive folder (or separate backup folder)
- Retention policy: Keep 30 days of backups

**Manual Backups:**
1. Right-click production sheet in Google Drive
2. Click **Make a copy** and save with date suffix
3. Move copy to secure "Backups" folder

---

## 5. Performance Optimization

### 5.1 API Call Optimization

**Current Optimizations:**
- SheetService batches operations (batchUpdateRows)
- getDataAsObjects caches results in memory
- Dashboard KPIs calculated at runtime (not stored)
- Pagination implemented (50 items per page)

**Future Optimizations:**
- Implement Redis caching for frequently accessed data
- Archive old expedientes to separate sheet after 2+ years
- Use Google Sheets' filter API for server-side filtering

### 5.2 Sheet Structure Optimization

**Index Strategy:**
- EXPEDIENTES sheet: Freeze row 1, enable filter
- GESTIONES sheet: Append-only (index by ID_GESTION)
- BITACORA sheet: Append-only (index by ID_LOG)
- Add hidden columns for internal calculations if needed

**Archival Strategy:**
- After expediente CLOSED for 2+ years, archive to EXPEDIENTES_ARCHIVE
- Reduces main sheet row count, improves filtering performance
- Keep archive for audit trail compliance

### 5.3 Query Performance

**Slow Operations to Monitor:**
1. listExpedientes() with complex filters → Use pagination
2. getHistorialExpediente() for 100+ gestiones → Cache in memory
3. getDashboardKPIs() on 1000+ expedientes → Optimize aggregation

**Mitigation:**
- Profile each service using Logger.time()/timeEnd()
- Set timeouts for operations >5 seconds
- Alert DevOps if sheets exceed 10,000 rows

---

## 6. Monitoring & Alerting

### 6.1 Application Monitoring

**Metrics to Track:**
1. **Availability:** App uptime, 404/500 error rate
2. **Performance:** API response times, query execution times
3. **Security:** Failed login attempts, unauthorized API calls
4. **Business:** KPIs (expedientes created, gestiones registered, overdue cases)

**Setup:**
1. Enable Google Apps Script's built-in error reporting
   - Apps Script Editor → Executions → View error details
2. Set up Google Cloud Logging (if using Cloud project)
3. Create dashboard in Google Data Studio (optional)

### 6.2 Alert Configuration

**Alert Triggers (in AlertService):**
```
ALERTA_CRITICO:  >30 days without movement
ALERTA_VENCIDO:  próxima_gestion < today
ALERTA_PROXIMO:  próxima_gestion within 3 days
ALERTA_SIN_MOV:  >=15 days without movement
```

**Alert Delivery (future):**
- Email notifications to supervisors (implement in AlertService)
- Slack/Teams integration for critical alerts
- Daily summary report

### 6.3 Logging & Audit Trail

**BitacoraService Log Fields:**
- ID_LOG: Unique identifier
- FECHA_HORA: When action occurred (UTC)
- USUARIO: Who performed action
- ROL: User's role at time of action
- HOJA: Which sheet affected
- ID_EXPEDIENTE: Related case (if applicable)
- ACCION: What was done (CREATE, UPDATE, DELETE, LOGIN)
- CAMPO: Field affected (if update)
- VALOR_ANTERIOR: Previous value
- VALOR_NUEVO: New value
- CONTEXTO: Additional context
- ORIGEN: Which module logged it

**Audit Queries (run in Google Sheets):**
```
Filter BITACORA by:
- Date range
- User
- Action type
- Expediente ID
Export to CSV for compliance reporting
```

---

## 7. Deployment Steps (Google Apps Script)

### 7.1 Deploy as Web App

**In Apps Script Editor:**

1. **Save Project**
   - Ctrl+S (or File → Save)
   - Ensure no syntax errors

2. **Deploy → New Deployment**
   - Click "Deploy" button (top right)
   - Select "New deployment"
   - Choose type: **Web App**

3. **Configure Deployment**
   - Description: `SIGECO 2.0 - Producción`
   - Execute as: `[your Google account]`
   - Who has access: `Anyone`
   - Click **Deploy**

4. **Record Deployment URL**
   - Copy the deployment URL:
     ```
     https://script.google.com/macros/d/{DEPLOYMENT_ID}/userweb...
     ```
   - Store securely (this is your production endpoint)

5. **Authorize Scopes**
   - Click "Review permissions"
   - Google will ask for authorization
   - Grant permissions for:
     - View and manage Google Sheets
     - Display web content
     - View email address

### 7.2 Test Deployment

**Quick Health Check:**
1. Open deployment URL in browser
2. You should see SIGECO login page
3. Login with admin credentials
4. Verify all menu items visible
5. Click each menu (should load without errors)

**Production Health Checks:**
```
1. Login test (valid/invalid credentials)
2. Create test expediente
3. Register test gestión
4. View dashboard (KPIs should calculate)
5. Check bitácora (actions logged)
6. Verify all roles see correct menu items
```

---

## 8. Domain & Custom URL (Optional)

### 8.1 Bind to Custom Domain

**Option A: Google Domains + Apps Script**
1. Register domain (e.g., `sigeco.municipio.gob.ec`)
2. Google Domains → DNS → Manage custom records
3. Create CNAME or A record pointing to Apps Script deployment
4. Update Apps Script deployment settings with custom domain

**Option B: Apps Script → Redirect**
1. Create a simple HTML redirect page
2. Host on custom domain, redirect to Apps Script URL

**Option C: CloudFlare or Nginx Reverse Proxy**
1. Set up reverse proxy at `sigeco.municipio.gob.ec`
2. All requests forwarded to Apps Script deployment URL
3. Provides additional security layer, caching, analytics

### 8.2 HTTPS & Security

- All Google Apps Script deployments automatically HTTPS
- SSL/TLS handled by Google
- No additional certificate needed

---

## 9. Post-Deployment Validation

### 9.1 Functional Testing

**Critical Paths to Test:**

1. **Authentication**
   - [ ] Login with valid credentials
   - [ ] Login with invalid credentials (should fail)
   - [ ] Session timeout after 8 hours
   - [ ] Logout clears session

2. **Expediente Management**
   - [ ] Create expediente (validates required fields)
   - [ ] Update expediente (only authorized users)
   - [ ] List expedientes with filters (pagination works)
   - [ ] View expediente detail + history
   - [ ] Close expediente (state change + log)

3. **Gestiones**
   - [ ] Register gestión (updates parent expediente)
   - [ ] Verify FECHA_ULTIMA_GESTION updates
   - [ ] Verify DIAS_SIN_MOVIMIENTO recalculates
   - [ ] Verify ALERTA_ESTADO updates correctly

4. **Seguimiento & Alerts**
   - [ ] Alerts calculated correctly for overdue cases
   - [ ] Seguimiento shows correct counts (vencidos, sin_movimiento, etc.)
   - [ ] Productividad ranking shows correct order

5. **Dashboard**
   - [ ] KPIs display correctly
   - [ ] Charts render (Chart.js)
   - [ ] Filter by date range works
   - [ ] Export CSV works (if implemented)

6. **Audit & Security**
   - [ ] BitácORA logs all actions
   - [ ] Cannot edit existing bitácora entries
   - [ ] Only AUDITOR can view bitácora
   - [ ] GESTOR cannot see other users' expedientes

### 9.2 Performance Testing

**Load Testing (with test data):**
1. Insert 1,000+ expedientes
2. Create 5,000+ gestiones
3. Measure:
   - Dashboard load time (should be <5 seconds)
   - List expedientes with filters (should be <3 seconds)
   - Create expediente (should be <2 seconds)

**Tools:**
- Google Apps Script's Performance Dashboard
- Chrome DevTools Network tab
- Google Drive quota usage (check in Drive settings)

### 9.3 Data Integrity Checks

**Run IntegrityService:**
1. In Apps Script Editor, run `runFullCheck()`
2. Verify no errors in report:
   - All 8 sheets exist
   - Headers match Constants
   - No orphaned gestiones
   - No expedientes without required fields
   - All user roles valid

---

## 10. Rollback Procedures

### 10.1 If Critical Issue Found

**Immediate Actions:**
1. **Pause App Access**
   - In Apps Script → Manage deployments
   - Delete current deployment (revokes URL)
   - Announcement to users (email/Slack)

2. **Restore from Backup**
   - Copy backup Google Sheet
   - Update SPREADSHEET_ID in PropertiesService
   - Test with test user first

3. **Revert Code**
   - In Google Apps Script → Versions
   - Select previous stable version
   - Deploy as new version

**Git Rollback (if needed):**
```bash
git revert d800927  # Revert architectural commit if necessary
git push origin main
```

### 10.2 Deployment Versioning

**Version Strategy:**
- Maintain version history in Constants.gs
  ```javascript
  PARAMS.VERSION_SISTEMA = '2.0.1-prod';
  PARAMS.VERSION_BUILD_DATE = '2026-03-25';
  PARAMS.VERSION_DEPLOYED_BY = 'admin@municipio.gob.ec';
  ```

---

## 11. Runbooks & Troubleshooting

### 11.1 Common Issues & Fixes

| Issue | Cause | Fix |
|---|---|---|
| "Hoja no encontrada" error | Missing sheet | Run setupSystem() again |
| Login fails for all users | PropertiesService corruption | Clear ScriptProperties, reset auth |
| Dashboard blank | Sheet data corrupted | Run IntegrityService to diagnose |
| Slow performance | Too many rows | Archive old expedientes |
| Permission denied | User role insufficient | Verify permission matrix in SecurityService |

### 11.2 Emergency Contacts

**On-Call Support:**
- System Administrator: [contact]
- Database Administrator: [contact]
- Security Team: [contact]
- Municipal IT Support: [contact]

---

## 12. Go-Live Checklist

**Final Sign-off Before Production:**

- [ ] All code reviewed and approved
- [ ] Security hardening completed
- [ ] Database initialized and tested
- [ ] Admin password changed
- [ ] Users created and notified
- [ ] Deployment URL tested
- [ ] Backup strategy documented
- [ ] Monitoring configured
- [ ] Runbooks prepared
- [ ] Training completed (users know how to use system)
- [ ] Legal/Compliance approved (GDPR, data retention, etc.)
- [ ] Sign-off from Municipality Director/CTO
- [ ] Announcement scheduled
- [ ] Support team trained and on-call

---

## 13. Post-Production Operations

### 13.1 Daily Tasks
- [ ] Monitor error logs in Apps Script
- [ ] Spot-check bitácora for suspicious activity
- [ ] Verify backups completed

### 13.2 Weekly Tasks
- [ ] Performance review (dashboard load times, API response times)
- [ ] Data integrity check (run runFullCheck() in development environment)
- [ ] User support issues review

### 13.3 Monthly Tasks
- [ ] Generate audit report from BITACORA
- [ ] Archive old expedientes (if row count >5000)
- [ ] Update production runbooks with new learnings

### 13.4 Quarterly Tasks
- [ ] Security audit
- [ ] Performance optimization review
- [ ] Capacity planning (growth rate analysis)

---

## Appendix: Quick Start for New Admins

**First-Time Admin Setup:**
1. Receive deployment URL and admin credentials
2. Open URL in browser
3. Login with `admin@municipio.gob.ec` + provided password
4. **IMMEDIATELY:** Change admin password (Usuarios → Edit)
5. Create supervisor and gestor accounts
6. Import contribuyentes CSV (Importar page)
7. Create 5-10 test expedientes
8. Add gestiones to test expedientes
9. Verify alerts, dashboard, bitácora work
10. Announce to team with training session

---

**Document Version:** 1.0
**Last Updated:** March 25, 2026
**Next Review:** June 25, 2026
