# Payment Abuse Detection Policy

**Status**: Implemented (SPIKE-147 / Issue #798)  
**Last Updated**: 2026-10-15

## Overview

ZK-VOTE relayer rails move funds via `/pay`, `/pay/batch`, `/ramp` endpoints without monitoring for financial abuse patterns. This policy defines detection for:

1. **Wash payments**: Self-dealing volume (sender↔receiver roundtrips)
2. **Structuring**: Splitting transactions to evade thresholds
3. **Mule convergence**: Many fresh accounts funneling to single receiver
4. **Rapid cycling**: Deposit → pay → withdraw in minutes (mixer-like behavior)

Detection operates within **privacy bounds**: metadata-only analysis, never links to vote nullifiers.

## Threat Model

### Abuse Typologies

| Pattern              | Description                                                                                        | Harm                                                           | Detection Signal                                               |
| -------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| **Wash Payments**    | A↔B roundtrip volume to simulate activity, farm rewards (cf. SPIKE-107)                            | Distorts governance participation metrics, drains reward pools | Same sender/receiver pair, high frequency within 1-hour window |
| **Structuring**      | Splitting large payment into many small ones just below thresholds (e.g., 9,999 instead of 10,000) | Evades reporting/governance limits, anti-abuse controls        | Multiple payments clustering at 95%+ of threshold within 24h   |
| **Mule Convergence** | Many accounts (possibly Sybil-funded per SPIKE-093) converge funds to single receiver              | Money laundering, proceeds consolidation                       | 10+ unique senders to one destination in 24h                   |
| **Rapid Cycling**    | Deposit (ramp) → pay → withdraw (ramp) in <15 minutes                                              | Mixer-adjacent behavior, obfuscation                           | Ramp inflow followed by outflow with minimal dwell time        |

### Privacy Boundaries (Red Lines)

**Never analyzed**:

- Vote nullifiers or ballot commitments
- DAO membership proofs
- Cross-subsystem joins (ramp identity ↔ voting activity)

**Only analyzed**:

- Payment timing (inter-arrival, batch frequency)
- Destination clustering (who pays whom, how often)
- Amount patterns (threshold proximity, structuring signals)
- Tenant-level aggregates (cross-payment volume)

Detection must not become **deanonymization oracle** - e.g., timing graphs that rebuild vote linkage via payment correlation.

## Detection Algorithms

### 1. Structuring Detection

```typescript
detectStructuring(payments: PaymentMetadata[], windowMs: number): AbuseDetectionResult
```

**Logic**:

- Filter payments within last 24 hours (default)
- Count payments where `amount >= threshold * 0.95` and `amount < threshold`
- Flag if ≥5 such payments detected

**Threshold**: 10,000 XLM equivalent (configurable via `ABUSE_THRESHOLDS.STRUCTURING_AMOUNT`)

**False Positives**: Legitimate high-volume users (e.g., payroll batches). Mitigation: confidence scoring + manual review queue.

### 2. Wash Payment Detection

```typescript
detectWashPayments(payments: PaymentMetadata[], windowMs: number): AbuseDetectionResult
```

**Logic**:

- Build sender→receiver pair frequency map
- Sort pairs (to detect bidirectional flows: A→B and B→A)
- Flag if any pair has ≥3 transactions within 1 hour

**Window**: 1 hour (default)

**False Positives**: Legitimate back-and-forth (e.g., escrow refunds). Mitigation: review context (refund reason codes).

### 3. Mule Convergence Detection

```typescript
detectMuleConvergence(destination: string, windowMs: number): AbuseDetectionResult
```

**Logic**:

- Query `payment_jobs` table for payments to `destination` in last 24h
- Count unique `tenant_id` senders
- Sum total amount
- Flag if ≥10 unique senders AND ≥1,000 XLM total

**Window**: 24 hours

**False Positives**: Legitimate payment hubs (exchanges, merchants). Mitigation: allowlist known hubs.

### 4. Rapid Cycling (Future)

**Not yet implemented** - requires ramp event correlation:

- Track deposit timestamp (from `/ramp/deposit`)
- Track withdrawal timestamp (from `/ramp/withdraw`)
- Flag if dwell time <15 minutes

## Integration

### Batch Payment Analysis

`analyzeBatchPayment()` runs all detection algorithms on `/pay/batch` requests:

1. Fetch recent payment history for `tenant_id` (last 24h, max 100 records)
2. Add current batch to analysis
3. Run structuring, wash, and mule detection
4. Combine results with confidence scoring

### Response Actions

| Confidence       | Action                                   |
| ---------------- | ---------------------------------------- |
| < 0.5 (Low)      | Log only, allow payment                  |
| 0.5-0.8 (Medium) | Log + metrics, allow payment             |
| ≥ 0.9 (High)     | **Block payment**, require manual review |

High-confidence blocks return:

```json
{
  "error": "Payment batch flagged for review due to suspicious patterns",
  "patterns": ["structuring", "wash_payment"],
  "reviewRequired": true
}
```

### Audit Trail

`recordAbuseDetection()` logs to `audit_log` table:

- `event_type`: "abuse_detection"
- `actor_type`: "system"
- `metadata`: JSON with patterns, confidence, context

Retention: Same as audit logs (compliance-driven, typically 1+ years).

## Metrics

Prometheus metrics for monitoring (`metrics.ts`):

- `zkvote_abuse_detection_total{pattern, confidence_level}`: Total detections by pattern
- `zkvote_abuse_pattern_confidence{pattern}`: Confidence distribution histogram
- `zkvote_suspicious_payment_volume_stroops{pattern}`: Flagged transaction volume
- `zkvote_payment_destination_fanout`: Unique destinations per batch (mule signal)

### Alerting Rules (Proposed)

Add to `monitoring/prometheus/zkvote-alerts.yml`:

```yaml
- alert: HighAbuseDetectionRate
  expr: rate(zkvote_abuse_detection_total[5m]) > 0.1
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "High abuse detection rate (>6/min sustained)"

- alert: HighConfidenceAbuse
  expr: increase(zkvote_abuse_detection_total{confidence_level="high"}[1h]) > 5
  labels:
    severity: critical
  annotations:
    summary: "Multiple high-confidence abuse detections (manual review needed)"
```

## Review Workflow

**Manual Review Queue** (not yet implemented - acceptance criteria):

1. **Analyst Dashboard**: View flagged payments with:
   - Pattern details (structuring count, wash pairs, mule senders)
   - Confidence score
   - Historical context (tenant payment history)
   - Redacted account identifiers (first 8 chars only)

2. **Actions**:
   - **Approve**: Allowlist tenant for future (legitimate high-volume user)
   - **Reject**: Confirm abuse, block tenant
   - **Escalate**: Refer to legal/compliance for SAR-like review

3. **Access Control**: Analyst role per SPIKE-123 RBAC (not implemented yet).

4. **Audit**: All review actions logged with reviewer ID, timestamp, reason.

## Red-Team Calibration

Detection effectiveness should be measured via **synthetic abuse campaigns**:

### Drill Scenarios

1. **Structuring Drill**:
   - Generate 10 payments of 9,900 XLM each in 24h
   - Expected: Detection with confidence ≥0.8

2. **Wash Drill**:
   - A→B and B→A, 5 roundtrips in 1 hour
   - Expected: Detection with confidence ≥0.9

3. **Mule Drill**:
   - 15 unique tenants → single destination, 20,000 XLM total in 24h
   - Expected: Detection with confidence ≥0.9

4. **False Positive Drill**:
   - Legitimate payroll batch (50 employees, regular amounts)
   - Expected: No detection (or low confidence <0.3)

### Metrics to Track

- **Detection rate**: % of synthetic abuse caught
- **False positive rate**: % of legitimate activity flagged
- **Time to detect**: Delay between abuse start and first flag

## Compliance Mapping

**Legal review required** to determine obligations:

- **FinCEN guidance** (US): Suspicious Activity Report (SAR) thresholds
- **EU 5AMLD**: Enhanced due diligence for high-risk patterns
- **Jurisdiction-specific**: Per-country reporting duties

This implementation **enables compliance** but does not **decide** it. Legal counsel determines:

- Which patterns require reporting (vs. internal monitoring only)
- SAR filing thresholds (if applicable)
- Data retention for reported vs. non-reported detections

## Limitations

1. **Cross-tenant blind spot**: Current detection scopes to single `tenant_id`. Coordinated abuse across tenants not detected.
2. **Ramp event correlation**: Rapid cycling detection requires ramp telemetry integration (not yet built).
3. **Allowlist management**: No UI for analysts to mark legitimate high-volume users (manual DB edits only).
4. **Appeal path**: Users blocked by high-confidence detection have no self-service appeal (requires support ticket).

## Testing

### Unit Tests

- [ ] Structuring: 5+ payments at 95%+ threshold flagged
- [ ] Wash: 3+ roundtrips in 1h flagged
- [ ] Mule: 10+ senders to one destination flagged
- [ ] Privacy boundary: No queries join `vote_nullifiers` table

### Integration Tests

- [ ] `/pay/batch` with structuring pattern returns 403
- [ ] Low-confidence detection allows payment, logs audit
- [ ] Metrics increment correctly per pattern

### Red-Team Drills

- [ ] Synthetic structuring campaign detected
- [ ] Synthetic wash payments detected
- [ ] Legitimate payroll batch NOT flagged (false positive test)

## Future Enhancements

1. **Differential privacy**: Aggregate detectors with provable query bounds (no vote linkage reconstruction)
2. **Machine learning**: Train on historical abuse corpus (if available)
3. **Cross-chain correlation**: Detect abuse spanning Stellar + other chains (if multichain support added)
4. **Real-time scoring**: Per-account abuse score updated on every payment (vs. per-batch analysis)

## References

- `backend/src/services/abuseDetection.ts` - Core detection logic
- `backend/src/routes/pay.ts` - Integration with batch payments
- `backend/src/services/metrics.ts` - Prometheus metrics
- SPIKE-147 (Issue #798) - Original spike specification
- THREAT_MODEL.md - Updated threat actors (to be added)
