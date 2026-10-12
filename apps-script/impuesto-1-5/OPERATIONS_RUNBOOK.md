# SIGECO 2.0 — Operations & Support Runbook

**System:** SIGECO (Sistema de Seguimiento Recaudatorio Institucional)
**Version:** 2.0
**Audience:** System Administrators, Help Desk, On-Call Support

---

## Quick Reference

**Production URL:** [TO BE FILLED]
**Admin Email:** admin@municipio.gob.ec
**Support Email:** [TO BE FILLED]
**On-Call Rotation:** [TO BE DEFINED]

---

## Daily Operations

### Morning Checks (7:00 AM)

1. **System Availability**
   ```
   - Open production URL in browser
   - Verify login page loads
   - If fails → Go to "System Down" section
   ```

2. **Check Error Logs**
   ```
   - Open Apps Script Editor
   - Click "Executions" tab
   - Review any failed runs
   - If errors > 5 in last hour → Contact System Admin
   ```

3. **Monitor Alerts**
   ```
   - Login to production
   - Go to Dashboard page
   - Check KPI card: "Expedientes Críticos"
   - If > 10 critical cases → Notify supervisors
   ```

4. **Backup Status**
   ```
   - Check Google Drive "SIGECO_Backups" folder
   - Verify today's backup exists (file from last 24 hours)
   - If missing → Run manual backup immediately
   ```

### Afternoon Check (2:00 PM)

1. **User Activity Review**
   ```
   - Login as admin
   - Go to "Bitácora" page
   - Filter by "Today"
   - Verify normal activity (create/update expedientes, gestiones)
   - If no activity → Check if system is in use
   ```

2. **Performance Check**
   ```
   - Go to Dashboard
   - Dashboard should load in <5 seconds
   - List Expedientes → Load time should be <3 seconds
   - If slower → Check Sheet row count (might need archival)
   ```

### Evening Check (5:00 PM)

1. **Wrap-up Summary**
   ```
   - Note any issues encountered
   - Update operations log (shared doc or tool)
   - Notify on-call person of handoff
   ```

---

## Common Issues & Resolutions

### Issue 1: Login Fails for All Users

**Symptoms:**
- All users get "Invalid credentials" even with correct password
- Or: User gets "Sesión inválida" (Invalid session)

**Diagnosis Steps:**
1. Check if app is deployed (should be in deployment URL)
2. Verify SPREADSHEET_ID is set
   - Apps Script → Project Settings → Script Properties
   - Should have key=SPREADSHEET_ID, value=[sheet ID]

**Quick Fix:**
```
1. Check ScriptProperties is correct
2. If in doubt, re-run setupSystem():
   - Code.gs → Select function dropdown → setupSystem
   - Click "Run"
   - Check Logger output
3. Force user to logout:
   - Go to Config sheet
   - You may need to manually delete user's session token
```

**If Still Broken:**
```
1. Verify Google Sheet exists and is accessible
2. Verify file permissions (admin account has access)
3. As last resort: Restore from backup
```

---

### Issue 2: "Hoja no encontrada" (Sheet Not Found)

**Symptoms:**
- Random error "Hoja no encontrada: EXPEDIENTES"
- One or more sheets missing from Google Sheet

**Root Cause:**
- setupSystem() not run, OR
- Sheets accidentally deleted, OR
- Google Drive sync issue

**Quick Fix:**
```
1. Check if all 8 sheets exist in Google Sheet:
   - CONFIG, USUARIOS, CONTRIBUYENTES, EXPEDIENTES
   - GESTIONES, SEGUIMIENTO, BITACORA, DASHBOARD

2. If missing sheets, run setupSystem():
   - Code.gs → setupSystem() → Run
   - Check Logger: "Hoja creada: [SHEET_NAME]"

3. If that fails, restore from backup:
   - Copy backup Google Sheet
   - Update SPREADSHEET_ID in PropertiesService
```

---

### Issue 3: Dashboard Shows Blank or Wrong Numbers

**Symptoms:**
- Dashboard KPIs show 0 or "undefined"
- Charts not loading

**Diagnosis:**
```
1. Check if EXPEDIENTES sheet has data:
   - Open production Google Sheet
   - Click EXPEDIENTES tab
   - Should see expediente records

2. If empty, data might be in wrong sheet
3. If wrong numbers, check calculation logic
```

**Quick Fix:**
```
1. Go to Apps Script Editor
2. Run: getDashboardKPIs() from DashboardService.gs
3. Check Logger output for calculation values
4. If still wrong, verify EXPEDIENTES data integrity:
   - Run: runFullCheck() from Code.gs
   - Check for "Campos críticos vacíos" errors
```

---

### Issue 4: Slow Performance

**Symptoms:**
- Dashboard takes >10 seconds to load
- Listing expedientes times out
- Creates taking >5 seconds

**Root Cause Analysis:**
```
1. Check row count in EXPEDIENTES:
   - Open Google Sheet → EXPEDIENTES
   - Look at row number (e.g., "Row 5,234")
   - If >5000 rows → Archive old data

2. Check for complex formulas:
   - Click any cell in EXPEDIENTES
   - Check formula bar for expensive calculations
   - Remove or move to Script

3. Check if filters are too complex:
   - Click filter icon
   - Review applied filters
   - Simplify if many conditions
```

**Performance Improvements:**
```
1. Archive old expedientes (EXPEDIENTES_ARCHIVE sheet)
   - Move closed expedientes >2 years old

2. Disable unused formulas:
   - Remove helper columns from DASHBOARD if calculated in Apps Script

3. Increase pagination:
   - In Constants.gs, change PAGE_SIZE = 100 (was 50)
   - Fewer API calls, but slower list loads

4. Clear filters:
   - Remove complex filtered views
   - Use backend filtering instead (more efficient)
```

---

### Issue 5: User Can't Create Expediente (Permission Error)

**Symptoms:**
- User clicks "Nuevo Expediente" button
- Gets error: "No tiene permisos para crear expediente"

**Diagnosis:**
```
1. Check user's role:
   - Go to USUARIOS sheet in Google Sheet
   - Find user's email
   - Check ROL column (should be GESTOR, SUPERVISOR, or ADMIN)

2. Check if user is ACTIVO:
   - ACTIVO column should be "TRUE"

3. Check permission matrix (in SecurityService.gs):
   - GESTOR can create expedientes ✓
   - SUPERVISOR can create expedientes ✓
   - AUDITOR cannot create expedientes ✗
```

**Quick Fix:**
```
1. If role is wrong, update user:
   - Login as admin
   - Go to Usuarios page
   - Edit user → Change role to GESTOR or SUPERVISOR

2. If ACTIVO=FALSE:
   - Toggle "ACTIVO" switch to TRUE

3. If user was just created:
   - User may need to logout and login again (cache issue)
   - Force clear browser cache (Ctrl+Shift+Delete)
```

---

### Issue 6: BITACORA Growing Too Large

**Symptoms:**
- BITACORA sheet has 10,000+ rows
- Performance impact on system
- Hard to search bitácora

**Management Strategy:**
```
1. Archive old log entries:
   - Create new sheet: BITACORA_ARCHIVE_2026Q1
   - Copy entries older than 90 days to archive
   - Delete from BITACORA

2. Set retention policy:
   - In Constants.gs: BITACORA_RETENTION_DAYS = 90
   - Implement cleanup job (future enhancement)

3. Export for compliance:
   - Export BITACORA to CSV monthly
   - Store in secure compliance folder
   - Delete from Google Sheet after export
```

---

## Periodic Maintenance Tasks

### Weekly (Every Monday 8:00 AM)

**Task: Performance Baseline Review**
```
1. Check App Script "Executions" dashboard
   - Note average execution time
   - Note error count (should be <1%)

2. Review user-reported issues
   - Check help desk tickets
   - Identify patterns (same user/action/time)

3. Verify backup successful
   - Check Google Drive backup folder
   - Should have 7 recent backups (one per day)
```

**Task: Security Audit**
```
1. Check USUARIOS sheet for unauthorized accounts
   - Should only have institutional email addresses
   - Remove any personal emails or test accounts

2. Verify no suspicious BITACORA activity:
   - Mass deletions from unauthorized users
   - Login attempts from unusual times/locations
   - Config changes made by non-admin

3. Review access logs (if available)
   - Check for repeated failed login attempts
   - Flag for potential brute force attack
```

### Monthly (First Monday of Month, 9:00 AM)

**Task: Data Integrity Check**
```
1. Run IntegrityService:
   - Apps Script Editor → Code.gs
   - Select function dropdown → runFullCheck()
   - Click "Run"
   - Check Logger output

2. Expected: No critical errors
   - Some warnings are OK
   - Critical errors require investigation

3. Document findings:
   - Note any issues found
   - Schedule fixes if needed
```

**Task: Capacity Planning**
```
1. Check Google Sheet size:
   - EXPEDIENTES rows: _____
   - GESTIONES rows: _____
   - BITACORA rows: _____
   - Total sheet size: _____ MB

2. Growth rate analysis:
   - New expedientes per day: _____
   - Growth trend (accelerating/stable): _____
   - Projected row count in 6 months: _____

3. Archive if needed:
   - If EXPEDIENTES >5000 rows, archive closed cases
   - If BITACORA >10000 rows, export and archive

4. Plan for database upgrade:
   - If growth continues, may need to move to database
   - Plan migration for v2.1 or v3.0
```

**Task: User Management**
```
1. Inactive accounts cleanup:
   - USUARIOS sheet → Find last login date
   - If >6 months inactive, mark for deletion
   - Archive old accounts (don't delete for audit trail)

2. Access review:
   - Verify roles match current responsibilities
   - Remove users who left organization
   - Update permissions if roles changed

3. Password rotation:
   - If password policy is 90 days, identify expired passwords
   - Send reset notifications
   - Force change on next login
```

### Quarterly (Every 3 Months)

**Task: Full System Backup & Recovery Test**
```
1. Create full backup:
   - Copy production Google Sheet
   - Rename: SIGECO_BACKUP_YYYY-MM-DD_PROD
   - Move to secure backup folder

2. Test recovery:
   - In development environment:
     a) Create new test sheet
     b) Import backup data
     c) Run setupSystem() verification
     d) Test login with backup data
   - Verify all data intact and accessible

3. Document recovery procedure:
   - Time to restore: _____ minutes
   - Success rate: _____ %
   - Issues encountered: _____
```

**Task: Security Review**
```
1. Code audit:
   - Review recent changes from git
   - Check for any security vulnerabilities
   - Verify no secrets committed

2. Access log review:
   - Export BITACORA for last 90 days
   - Analyze patterns (unusual access times/locations)
   - Report to security team if anomalies found

3. Compliance check:
   - Verify GDPR/data protection compliance
   - Document data retention/deletion actions
   - Verify no PII exposed in logs
```

**Task: Performance Optimization**
```
1. Query optimization:
   - Identify slow operations from logs
   - Review and optimize Service functions
   - Consider caching strategies

2. Database structure optimization:
   - Review sheet structure
   - Add hidden columns if needed for calculations
   - Remove unused columns

3. Frontend optimization:
   - Minify CSS/JavaScript in Index.html
   - Optimize images and assets
   - Test on slow connections
```

---

## Disaster Recovery Procedures

### Scenario 1: Accidental Data Deletion

**Situation:** A user accidentally deleted all expedientes from EXPEDIENTES sheet

**Steps:**
1. **Immediate:** Stop app access
   ```
   - Delete deployment (revokes URL)
   - Users cannot make changes during recovery
   ```

2. **Restore from Backup:**
   ```
   - Go to Google Drive
   - Find SIGECO_BACKUP_latest or SIGECO_PRODUCCION_BACKUP
   - Make a copy: SIGECO_RESTORED_[DATE]
   - Copy all sheet data from backup
   - Replace data in SIGECO_PRODUCCION
   ```

3. **Verify Data:**
   ```
   - Run IntegrityService
   - Check row counts match backup
   - Test critical workflows
   ```

4. **Redeploy App:**
   ```
   - Apps Script → Deploy new version
   - Test with small group first
   - Full rollout after verification
   ```

**Prevention:**
```
- Limit permissions (only supervisors can delete)
- Implement soft delete (ACTIVO=FALSE instead of actual delete)
- Weekly backup to Google Drive (automatic)
```

---

### Scenario 2: Corrupted Data

**Situation:** EXPEDIENTES sheet has corrupted data, broken formulas, or orphaned records

**Steps:**
1. **Identify Issue:**
   ```
   - Run IntegrityService: runFullCheck()
   - Review detailed error report
   - Note affected expedientes
   ```

2. **Scope Assessment:**
   ```
   - Is it isolated (few expedientes) or widespread?
   - Can it be fixed manually or needs restore?
   - How old is last good backup?
   ```

3. **Targeted Fix:**
   ```
   - For isolated issues:
     a) Open Google Sheet
     b) Manually correct affected rows
     c) Re-run IntegrityService to verify
   ```

4. **Full Restore (if widespread):**
   ```
   - Restore from backup (see Scenario 1)
   - Verify data integrity post-restore
   ```

---

### Scenario 3: Security Breach

**Situation:** Evidence of unauthorized access or data compromise

**Steps:**
1. **Immediate Actions:**
   ```
   - Isolate system (take offline if critical)
   - Notify security team and management
   - Preserve logs (export BITACORA)
   ```

2. **Investigate:**
   ```
   - Check BITACORA for suspicious activity:
     * Unusual login attempts
     * Unauthorized data access
     * Unexpected deletions or changes
   - Review Apps Script execution logs
   - Check Google Drive access logs
   ```

3. **Containment:**
   ```
   - Reset all user passwords
   - Disable suspicious accounts
   - Revoke compromised tokens
   - Update SPREADSHEET_ID if needed
   ```

4. **Recovery:**
   ```
   - Restore from known-good backup
   - Review changes since backup timestamp
   - Reapply legitimate changes manually
   ```

5. **Post-Incident:**
   ```
   - Conduct security audit
   - Implement preventive measures
   - Train users on security best practices
   - Document incident (required for compliance)
   ```

---

## Monitoring & Health Checks

### Real-Time Monitoring Checklist

**Every Hour (Automated or Manual):**
- [ ] System responds to requests (ping)
- [ ] Database accessible
- [ ] No error stack in logs >5

**Every 4 Hours (Manual Review):**
- [ ] Average response time <3 seconds
- [ ] Error rate <0.1%
- [ ] No unusual patterns in API calls

**Daily (Comprehensive):**
- [ ] All 8 sheets exist
- [ ] Data integrity (run IntegrityService weekly)
- [ ] Backup completed successfully
- [ ] No critical alerts (>10 expedientes críticos)

---

## On-Call Procedures

### Escalation Matrix

```
Issue Level → First Response → Escalate If
─────────────────────────────────────────────
INFO         → Help Desk      → Not applicable
WARNING      → Help Desk      → Not resolved in 1 hour
ERROR        → System Admin   → Blocks multiple users
CRITICAL     → Ops Lead       → System down or data loss
```

### On-Call Handoff

**Outgoing (End of shift):**
1. Summarize any ongoing issues
2. Note which systems are healthy
3. Flag any concerns for next shift
4. Provide access credentials

**Incoming (Start of shift):**
1. Review health checks
2. Acknowledge any ongoing issues
3. Set up monitoring tools
4. Be available for escalations

---

## Contact & Escalation

**Primary Support:** [DEFINE]
**On-Call Rotation:** [DEFINE]
**Manager Escalation:** [DEFINE]
**CTO/Director:** [DEFINE]

---

**Document Version:** 1.0
**Last Updated:** March 25, 2026
**Next Review:** June 25, 2026
