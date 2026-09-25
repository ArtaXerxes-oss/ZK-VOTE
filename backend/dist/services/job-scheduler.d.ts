/**
 * Unified Background Job Scheduler
 *
 * Coordinates periodic maintenance and reconciliation jobs:
 * - cleanup_stale_sessions: evicts expired relay sessions, nonces, and updates session_store_size
 * - token:maintenance: expires, revokes, and rotates auth tokens
 * - rate_limit:maintenance: computes and updates rate_limit_store_size
 * - reconciliation:check: verifies integrity between SQLite WAL, relayer state, and on-chain ledger
 */
export interface JobSchedulerOptions {
    intervalMs?: number;
    runImmediately?: boolean;
}
export declare class JobScheduler {
    private timer;
    private running;
    private intervalMs;
    constructor(options?: JobSchedulerOptions);
    /**
     * Start recurring job scheduler loop
     */
    start(): void;
    /**
     * Stop recurring scheduler
     */
    stop(): void;
    /**
     * Run a single tick of all registered scheduled tasks
     */
    tick(): Promise<{
        cleanedSessions: number;
        tokenMaintenance: any;
        rateLimitKeys: number;
    }>;
    /**
     * Evicts expired relay sessions and capabilities
     */
    cleanupStaleSessions(): number;
    /**
     * Inspect and update rate limit metrics
     */
    updateStoreMetrics(): number;
    /**
     * Check for state reconciliation anomalies between local database and expected state
     */
    checkStateReconciliation(): void;
}
export declare const defaultJobScheduler: JobScheduler;
//# sourceMappingURL=job-scheduler.d.ts.map