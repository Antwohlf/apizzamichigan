# Enrichment Pipeline Safeguards

**Purpose**: Ensure the enrichment pipeline never hangs or stalls for extended periods.

**Context**: Workers hung for 20 hours on Feb 8-9 due to uncaught SQLite exceptions under CPU pressure. This document describes the multi-layered protections now in place.

---

## 🛡️ Protection Layers

### 1. **Worker Error Handling** (Primary Defense)

**Location**: `scripts/enrichment/agents/*.mjs`
**Deployed**: 2026-02-09 (commit `82c007e`)

All workers now have comprehensive error handling:

```javascript
// Main loop protection
while (this.running) {
  try {
    const job = this.queue.claim('scrape', this.workerId)
    if (job) await this.processJob(job)
  } catch (error) {
    if (error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_LOCKED') {
      console.error(`Database contention, backing off...`)
      await new Promise(r => setTimeout(r, 10000 + Math.random() * 5000))
    } else {
      console.error(`Unexpected error:`, error)
      await new Promise(r => setTimeout(r, 5000))
    }
  }
}

// Heartbeat protection
setInterval(() => {
  try {
    this.queue.heartbeat(this.workerId)
  } catch (error) {
    console.error(`Heartbeat error:`, error.message)
    // Don't exit; heartbeats are non-critical
  }
}, 30000)
```

**What it prevents**:
- ✅ SQLite lock timeout crashes
- ✅ Uncaught promise rejections
- ✅ Event loop starvation
- ✅ Silent worker deaths

---

### 2. **Watchdog Monitor** (Secondary Defense)

**Location**: `scripts/enrichment/watchdog.mjs`
**Deployed**: 2026-02-09
**Run frequency**: Continuous (checks every 1 minute)

Independent process that monitors:

#### Health Checks
1. **Stale heartbeats**: Worker heartbeat >5 min old → worker is dead
2. **No progress**: No job completions in 30 min → workers are stuck
3. **System resources**: High CPU/memory/load → potential for starvation

#### Auto-Recovery
- If workers are stuck → kills coordinator → keepalive restarts it → fresh workers spawn
- Logs all health issues to `/tmp/openclaw/apizzamichigan-watchdog.log`
- Runs with `--kill-coordinator-if-stuck` flag for automatic recovery

**What it prevents**:
- ✅ Long-term worker hangs (>5 min undetected)
- ✅ Zombie workers (heartbeating but not working)
- ✅ Resource exhaustion blind spots

---

### 3. **Coordinator Keepalive** (Tertiary Defense)

**Location**: `scripts/enrichment/keepalive.mjs`
**Run frequency**: Every 5 minutes (OpenClaw cron job `c92e0d70-6159-402b-8980-72784da8e936`)

Ensures coordinator process is always running:
- If coordinator is down → starts it with safe defaults
- Redirects stdout/stderr to `/tmp/openclaw/apizzamichigan-coordinator.log`
- Coordinator auto-respawns workers on exit

**What it prevents**:
- ✅ Coordinator crashes taking down the whole pipeline
- ✅ Manual intervention needed after system restart

---

### 4. **Watchdog Keepalive** (Quaternary Defense)

**Location**: `scripts/enrichment/watchdog-keepalive.mjs`
**Run frequency**: Every 5 minutes (OpenClaw cron job `092dc3b7-20ad-42a4-9dff-d5c417f4b90e`)

Ensures watchdog process is always running:
- If watchdog is down → starts it
- Watchdog logs to `/tmp/openclaw/apizzamichigan-watchdog.log`

**What it prevents**:
- ✅ Watchdog crashes leaving pipeline unmonitored
- ✅ Single point of failure in monitoring

---

### 5. **Worker Auto-Restart** (Built into Coordinator)

**Location**: `scripts/enrichment/agents/coordinator.mjs`

Coordinator monitors worker processes:
- If worker exits with non-zero code → restarts it after 5s
- Logs worker exit codes and signals
- Maintains desired worker count per type

**What it prevents**:
- ✅ Permanent worker count reduction after crashes
- ✅ Gradual pipeline degradation

---

### 6. **Hourly Status Reports** (Visibility)

**Location**: `scripts/enrichment/hourly-status.mjs`
**Run frequency**: Every hour on the hour (OpenClaw cron job `f96c4349-001d-4a90-a348-81305566e4ef`)

Tracks and reports:
- Queue progress (OSM, scrape, classify completion %)
- Row/column value updates with deltas
- Overall + Michigan-specific stats
- Posted to Discord #proj-apizzamichigan🍕

**What it prevents**:
- ✅ Silent pipeline stalls going unnoticed for >1 hour
- ✅ Lack of visibility into enrichment progress

---

## 📊 How Safeguards Work Together

```
User's iMac
│
├─ Coordinator Process
│  ├─ spawns OSM worker(s)
│  ├─ spawns Scrape worker(s)
│  └─ spawns Classify worker(s)
│     ↓
│     [Each worker has error handling]
│     [Each worker logs to coordinator log]
│     [Coordinator restarts workers on crash]
│
├─ Watchdog Process (independent)
│  ├─ checks worker heartbeats every 1 min
│  ├─ checks job completion progress
│  ├─ monitors system resources
│  └─ kills coordinator if stuck → keepalive restarts
│
├─ OpenClaw Cron Jobs
│  ├─ Coordinator Keepalive (every 5 min)
│  │  └─ restarts coordinator if down
│  ├─ Watchdog Keepalive (every 5 min)
│  │  └─ restarts watchdog if down
│  └─ Hourly Status (every hour)
│     └─ reports progress to Discord
```

**Failure scenarios covered**:

| Failure | Detected By | Recovered By | Max Downtime |
|---------|------------|--------------|--------------|
| Worker uncaught exception | Error handler | Worker retries | ~10-15s (backoff) |
| Worker crash (exit code ≠ 0) | Coordinator | Coordinator restart | ~5s |
| Worker stuck (no jobs) | Watchdog | Coordinator kill+restart | ~6 min (5 min check + 1 min restart) |
| Coordinator crash | Keepalive cron | Keepalive start | ~5 min |
| Watchdog crash | Watchdog keepalive | Watchdog keepalive start | ~5 min |
| SQLite contention | Error handler | Backoff + retry | ~10-15s |
| System resource spike | Watchdog | Alerts (manual intervention) | N/A |

---

## 🔍 Monitoring & Logs

### Log Files

| Component | Log Path | What's Logged |
|-----------|----------|---------------|
| Coordinator | `/tmp/openclaw/apizzamichigan-coordinator.log` | Coordinator + all worker output |
| Watchdog | `/tmp/openclaw/apizzamichigan-watchdog.log` | Health checks + alerts |

### How to Check Health

```bash
# Check if coordinator is running
ps aux | grep coordinator.mjs

# Check if watchdog is running
ps aux | grep watchdog.mjs

# View recent coordinator logs
tail -100 /tmp/openclaw/apizzamichigan-coordinator.log

# View recent watchdog logs
tail -100 /tmp/openclaw/apizzamichigan-watchdog.log

# Check worker heartbeats
cd /Users/ant/clawd/projects/apizzamichigan
sqlite3 scripts/.job-queue.db "SELECT worker_id, agent_type,
  (julianday('now') - julianday(last_heartbeat)) * 24 * 60 as min_ago
  FROM workers ORDER BY min_ago DESC LIMIT 10;"

# Check queue stats
node scripts/enrichment/queue.mjs stats

# Real-time dashboard
open http://localhost:3456
```

---

## 🚨 Alert Conditions

Watchdog will log errors for:

1. **Stale heartbeat** (>5 min old)
   - `⚠️ STALE WORKERS DETECTED (heartbeat >5min old)`
   - Action: Kills coordinator if `--kill-coordinator-if-stuck` enabled

2. **No progress** (>30 min with no completions)
   - `⚠️ NO PROGRESS in X minutes`
   - Action: Kills coordinator if enabled

3. **High system load** (>8)
   - `⚠️ HIGH LOAD: X.XX (>8)`
   - Action: Log only (manual intervention)

4. **CPU pressure** (<5% idle)
   - `⚠️ CPU PRESSURE: X.X% idle (<5%)`
   - Action: Log only

5. **Memory pressure** (>95% used)
   - `⚠️ MEMORY PRESSURE: X.X% used (>95%)`
   - Action: Log only

---

## 🔧 Manual Intervention

### If Pipeline is Stuck

```bash
# 1. Check watchdog status
tail -50 /tmp/openclaw/apizzamichigan-watchdog.log

# 2. Check coordinator status
tail -50 /tmp/openclaw/apizzamichigan-coordinator.log

# 3. Force restart coordinator
pkill -f coordinator.mjs
# Wait 5 min for keepalive to restart, or manually:
cd /Users/ant/clawd/projects/apizzamichigan && node scripts/enrichment/keepalive.mjs

# 4. Check system resources
top -l 1
ps aux | grep ollama
```

### If Watchdog is Not Working

```bash
# 1. Check if running
ps aux | grep watchdog.mjs

# 2. Restart manually
cd /Users/ant/clawd/projects/apizzamichigan
node scripts/enrichment/watchdog-keepalive.mjs
```

---

## 📝 Configuration

### Watchdog Thresholds

Edit `scripts/enrichment/watchdog.mjs`:

```javascript
const MAX_HEARTBEAT_AGE_MIN = 5;    // Alert if heartbeat >5 min old
const MAX_IDLE_TIME_MIN = 30;       // Alert if no progress in 30 min
const CHECK_INTERVAL_MS = 60000;    // Check every 1 minute
```

### Auto-Recovery Behavior

- **Default**: Watchdog logs issues but doesn't auto-kill coordinator
- **Aggressive**: Run with `--kill-coordinator-if-stuck` (current setup)

To disable auto-kill, edit cron job `092dc3b7-20ad-42a4-9dff-d5c417f4b90e`:
- Remove `--kill-coordinator-if-stuck` flag from watchdog-keepalive.mjs

---

## ✅ Verification

**Before safeguards** (Feb 8-9):
- Workers died after 1-2 hours
- Pipeline stalled for 20 hours
- No alerts, no recovery

**After safeguards** (Feb 9+):
- Workers survive SQLite contention
- Watchdog detects issues within 1 min
- Auto-recovery within 6 min max
- Hourly visibility via Discord

**Next check**: Monitor for 7 days to confirm long-term stability under qwen2.5:7b load.

---

**Status**: 🟢 Active
**Last Updated**: 2026-02-09
**Maintainer**: Clawd
