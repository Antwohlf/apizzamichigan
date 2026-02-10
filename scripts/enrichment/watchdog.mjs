#!/usr/bin/env node
/**
 * Worker Watchdog
 * 
 * Monitors worker health and restarts stuck/dead workers.
 * Runs independently from the coordinator to catch coordinator failures too.
 * 
 * Checks:
 * - Worker heartbeats (>5 min old = dead)
 * - Job processing rate (no completions in 30 min = stuck)
 * - System resources (CPU/memory pressure)
 * 
 * Usage:
 *   node watchdog.mjs [--kill-coordinator-if-stuck]
 */

import { getQueue } from './queue.mjs';
import { execSync } from 'child_process';
import { existsSync } from 'fs';

const MAX_HEARTBEAT_AGE_MIN = 5;
const MAX_IDLE_TIME_MIN = 30; // No job completions in this time = stuck
const CHECK_INTERVAL_MS = 60000; // Check every 1 minute

class Watchdog {
  constructor(options = {}) {
    this.killCoordinatorIfStuck = options.killCoordinatorIfStuck || false;
    this.queue = getQueue();
    this.previousStats = null;
  }

  /**
   * Check if coordinator process is running
   */
  isCoordinatorRunning() {
    try {
      const output = execSync('ps aux | grep "coordinator.mjs" | grep -v grep', { 
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore']
      });
      return output.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get current worker stats
   */
  getWorkerStats() {
    const workers = this.queue.getWorkers();
    const stats = this.queue.getStats();
    
    return {
      workers,
      totalCompleted: stats.totals.completed,
      totalFailed: stats.totals.failed,
      timestamp: Date.now()
    };
  }

  /**
   * Check for stale workers (heartbeat too old)
   */
  checkStaleWorkers(workers) {
    const stale = workers.filter(w => w.minutes_since_heartbeat > MAX_HEARTBEAT_AGE_MIN);
    
    if (stale.length > 0) {
      console.error(`⚠️  STALE WORKERS DETECTED (heartbeat >${MAX_HEARTBEAT_AGE_MIN}min old):`);
      for (const w of stale) {
        console.error(`   - ${w.worker_id} (${w.agent_type}): last heartbeat ${Math.round(w.minutes_since_heartbeat)}min ago`);
      }
      return stale;
    }
    
    return [];
  }

  /**
   * Check for stuck workers (no job completions in X time)
   */
  checkStuckWorkers(current, previous) {
    if (!previous) return [];

    const timeSinceLastCheck = (current.timestamp - previous.timestamp) / 1000 / 60; // minutes
    
    if (timeSinceLastCheck < MAX_IDLE_TIME_MIN) {
      return []; // Not enough time elapsed
    }

    const completedDelta = current.totalCompleted - previous.totalCompleted;
    const failedDelta = current.totalFailed - previous.totalFailed;
    const totalProgress = completedDelta + failedDelta;

    if (totalProgress === 0 && current.workers.length > 0) {
      console.error(`⚠️  NO PROGRESS in ${Math.round(timeSinceLastCheck)} minutes`);
      console.error(`   Active workers: ${current.workers.length}`);
      console.error(`   Completed delta: ${completedDelta}`);
      console.error(`   Failed delta: ${failedDelta}`);
      return current.workers;
    }

    return [];
  }

  /**
   * Check system resources
   */
  checkSystemResources() {
    try {
      const top = execSync('top -l 1 | head -10', { encoding: 'utf-8' });
      const loadLine = top.split('\n').find(l => l.includes('Load Avg'));
      const cpuLine = top.split('\n').find(l => l.includes('CPU usage'));
      const memLine = top.split('\n').find(l => l.includes('PhysMem'));

      // Extract load average
      const loadMatch = loadLine?.match(/Load Avg: ([\d.]+)/);
      const load = loadMatch ? parseFloat(loadMatch[1]) : 0;

      // Extract CPU idle percentage
      const idleMatch = cpuLine?.match(/([\d.]+)% idle/);
      const idle = idleMatch ? parseFloat(idleMatch[1]) : 100;

      // Extract memory usage
      const memMatch = memLine?.match(/([\d.]+)([GM]) used.*?([\d.]+)([GM]) unused/);
      let memUsedGB = 0;
      let memTotalGB = 0;
      if (memMatch) {
        memUsedGB = parseFloat(memMatch[1]) * (memMatch[2] === 'G' ? 1 : 0.001);
        const memUnusedGB = parseFloat(memMatch[3]) * (memMatch[4] === 'G' ? 1 : 0.001);
        memTotalGB = memUsedGB + memUnusedGB;
      }

      const resources = {
        load,
        cpuIdle: idle,
        memUsedGB,
        memTotalGB,
        memUsedPct: memTotalGB > 0 ? (memUsedGB / memTotalGB) * 100 : 0
      };

      // Alert on high pressure
      if (load > 8) {
        console.warn(`⚠️  HIGH LOAD: ${load.toFixed(2)} (>8)`);
      }
      if (idle < 5) {
        console.warn(`⚠️  CPU PRESSURE: ${idle.toFixed(1)}% idle (<5%)`);
      }
      if (resources.memUsedPct > 95) {
        console.warn(`⚠️  MEMORY PRESSURE: ${resources.memUsedPct.toFixed(1)}% used (>95%)`);
      }

      return resources;
    } catch (error) {
      console.error('Failed to check system resources:', error.message);
      return null;
    }
  }

  /**
   * Kill coordinator if it's stuck
   */
  killCoordinator() {
    console.error('🔪 KILLING COORDINATOR (stuck)');
    try {
      execSync('pkill -f "coordinator.mjs"');
      console.log('✅ Coordinator killed; keepalive will restart it');
    } catch (error) {
      console.error('Failed to kill coordinator:', error.message);
    }
  }

  /**
   * Main watchdog loop
   */
  async run() {
    console.log('🐕 Watchdog started');
    console.log(`   Max heartbeat age: ${MAX_HEARTBEAT_AGE_MIN} min`);
    console.log(`   Max idle time: ${MAX_IDLE_TIME_MIN} min`);
    console.log(`   Kill coordinator if stuck: ${this.killCoordinatorIfStuck}`);
    console.log('');

    while (true) {
      try {
        const current = this.getWorkerStats();
        
        console.log(`[${new Date().toISOString()}] Health check:`);
        console.log(`  Workers: ${current.workers.length} registered`);
        console.log(`  Total completed: ${current.totalCompleted.toLocaleString()}`);
        
        // Check for problems
        const staleWorkers = this.checkStaleWorkers(current.workers);
        const stuckWorkers = this.checkStuckWorkers(current, this.previousStats);
        const resources = this.checkSystemResources();

        // Take action if needed
        if (staleWorkers.length > 0 || stuckWorkers.length > 0) {
          console.error('');
          console.error('🚨 WORKER HEALTH ISSUES DETECTED');
          
          if (!this.isCoordinatorRunning()) {
            console.error('   ⚠️  Coordinator is not running! Keepalive should restart it.');
          } else if (this.killCoordinatorIfStuck && stuckWorkers.length > 0) {
            // Kill coordinator to force full restart
            this.killCoordinator();
          } else {
            console.error('   ℹ️  Keepalive will restart coordinator every 5 min if down');
            console.error('   ℹ️  To auto-kill stuck coordinator, run with --kill-coordinator-if-stuck');
          }
          console.error('');
        }

        this.previousStats = current;
        
        // Wait before next check
        await new Promise(r => setTimeout(r, CHECK_INTERVAL_MS));
      } catch (error) {
        console.error('Watchdog error:', error);
        await new Promise(r => setTimeout(r, CHECK_INTERVAL_MS));
      }
    }
  }
}

// CLI
const args = process.argv.slice(2);
const killCoordinatorIfStuck = args.includes('--kill-coordinator-if-stuck');

const watchdog = new Watchdog({ killCoordinatorIfStuck });
watchdog.run().catch(console.error);
