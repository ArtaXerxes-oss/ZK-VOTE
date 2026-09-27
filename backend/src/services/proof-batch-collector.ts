/**
 * ProofBatchCollector — vote proof aggregation service (#476)
 *
 * Collects individual vote proofs from callers and flushes them as batches to
 * the existing cast_votes contract entry point via the vote/batch path.  This
 * is the "aggregation service" sub-task from #476: the contract entry point and
 * relayer endpoint were already delivered in #90/#472; this file wires up the
 * collection layer so batching actually happens in production rather than only
 * being available to callers who pre-assemble their own batches.
 *
 * Flush triggers (whichever fires first):
 *   1. The pending queue for a (daoId, proposalId) pair reaches MAX_BATCH_SIZE.
 *   2. The configurable flush window (flushMs) expires after the first enqueue.
 *
 * The service is intentionally stateless w.r.t. persistence: if the process
 * restarts before a flush, any buffered proofs are lost.  Callers that need
 * durability should submit directly via POST /vote/batch.
 */

import { EventEmitter } from "events";

export interface BatchVoteEntry {
  choice: boolean;
  nullifier: string;
  root: string;
  proof: {
    proof_a: string;
    proof_b: string;
    proof_c: string;
  };
}

export interface BatchFlushResult {
  daoId: number;
  proposalId: number;
  flushed: number;
  /** Resolved value from the flush handler, or the rejection reason. */
  result: unknown;
}

export type FlushHandler = (
  daoId: number,
  proposalId: number,
  votes: BatchVoteEntry[],
) => Promise<unknown>;

export interface ProofBatchCollectorOptions {
  /** Maximum votes per on-chain batch.  Matches MAX_VOTE_BATCH (64). */
  maxBatchSize?: number;
  /** Milliseconds to wait after the first enqueue before flushing a partial batch. */
  flushMs?: number;
  /** Called when a batch is ready to submit.  Inject the real relay call here. */
  onFlush: FlushHandler;
}

/** Key identifying one open batch. */
type BatchKey = `${number}:${number}`;

interface PendingBatch {
  votes: BatchVoteEntry[];
  timer: ReturnType<typeof setTimeout>;
}

export class ProofBatchCollector extends EventEmitter {
  private readonly maxBatchSize: number;
  private readonly flushMs: number;
  private readonly onFlush: FlushHandler;
  private readonly pending = new Map<BatchKey, PendingBatch>();
  private closed = false;

  constructor(options: ProofBatchCollectorOptions) {
    super();
    this.maxBatchSize = options.maxBatchSize ?? 64;
    this.flushMs = options.flushMs ?? 2000;
    this.onFlush = options.onFlush;
  }

  /**
   * Enqueue a single vote proof.  Returns immediately; the actual submission
   * happens asynchronously when the batch is flushed.
   *
   * Emits "flush" with a BatchFlushResult when a batch is submitted.
   * Emits "error" if the flush handler rejects.
   */
  enqueue(daoId: number, proposalId: number, vote: BatchVoteEntry): void {
    if (this.closed) throw new Error("ProofBatchCollector has been shut down");

    const key: BatchKey = `${daoId}:${proposalId}`;
    let batch = this.pending.get(key);

    if (!batch) {
      const timer = setTimeout(() => this._flush(daoId, proposalId), this.flushMs);
      batch = { votes: [], timer };
      this.pending.set(key, batch);
    }

    batch.votes.push(vote);

    if (batch.votes.length >= this.maxBatchSize) {
      // Batch full — flush immediately without waiting for the timer.
      clearTimeout(batch.timer);
      this._flush(daoId, proposalId);
    }
  }

  /** Flush all pending batches and resolve once every handler settles. */
  async drainAll(): Promise<BatchFlushResult[]> {
    const keys = [...this.pending.keys()];
    const results = await Promise.allSettled(
      keys.map((key) => {
        const [daoId, proposalId] = key.split(":").map(Number);
        return this._flush(daoId, proposalId);
      }),
    );
    return results.map((r) =>
      r.status === "fulfilled" ? r.value : (r.reason as BatchFlushResult),
    );
  }

  /** Stop accepting new enqueues and drain all pending batches. */
  async shutdown(): Promise<void> {
    this.closed = true;
    await this.drainAll();
  }

  private async _flush(daoId: number, proposalId: number): Promise<BatchFlushResult> {
    const key: BatchKey = `${daoId}:${proposalId}`;
    const batch = this.pending.get(key);
    if (!batch || batch.votes.length === 0) {
      return { daoId, proposalId, flushed: 0, result: null };
    }

    clearTimeout(batch.timer);
    this.pending.delete(key);
    const votes = batch.votes;

    let result: unknown;
    try {
      result = await this.onFlush(daoId, proposalId, votes);
      const outcome: BatchFlushResult = { daoId, proposalId, flushed: votes.length, result };
      this.emit("flush", outcome);
      return outcome;
    } catch (err) {
      const outcome: BatchFlushResult = { daoId, proposalId, flushed: votes.length, result: err };
      this.emit("error", err);
      return outcome;
    }
  }
}
