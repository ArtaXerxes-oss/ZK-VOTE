# Runbook: Panic Mode + Fee Surge

## Scenario

Panic mode activated during network fee surge (typically election final hour).

## Detection

- Alert: `CombinedFaultFeeSurgePanic`
- Symptoms: Vote submissions failing, fees 5x+ normal, panic mode active

## Impact

- Users cannot submit votes during panic
- High fees make rotation expensive
- Support ticket surge expected

## Response Priority

**PANIC-FIRST**: Integrity over availability

## Procedure

### 1. Assess Situation (2 minutes)

**Authority**: Senior on-call engineer

```bash
# Check panic status
curl https://api.zkvote.io/voting/panic/status

# Check fee levels
curl https://api.zkvote.io/stellar/fees

# Check vote success rate
curl https://api.zkvote.io/metrics | grep vote_success_rate
```

**Decision Point**: Is panic justified?

- YES: Continue to step 2
- NO: Consider panic deactivation (requires security lead approval)

### 2. Communicate Status (5 minutes)

**Authority**: On-call engineer

- [ ] Post degraded status banner
- [ ] Update status page
- [ ] Alert support team (expect 3x normal ticket volume)
- [ ] Internal Slack: #incident-response

**Template**:

```
Status: DEGRADED
Voting temporarily paused for security review.
Fee surge: Network congestion may delay operations.
ETA: Under investigation
```

### 3. Monitor Fee Trends (Ongoing)

**Baseline**: Track fee median every 60 seconds

```bash
# Watch fees
watch -n 60 'curl -s https://horizon.stellar.org/ledgers?order=desc&limit=1 | jq .base_fee'
```

**Thresholds**:

- < 5x baseline: Improving
- 5-10x: Holding
- > 10x: Worsening

### 4. Plan Recovery (15 minutes)

**If fees stabilizing (< 5x)**:

- Prepare to deactivate panic
- Schedule verification window
- Brief support on recovery

**If fees high (> 10x)**:

- Extend panic duration
- Consider election extension
- Coordinate with Stellar Foundation if network-wide

### 5. Execute Recovery (Variable)

**Requirements**:

- [ ] Fees below 3x baseline for 10 minutes
- [ ] No active compromise indicators
- [ ] Security lead approval

```bash
# Deactivate panic
./scripts/ops/panic-deactivate.sh

# Verify voting resumed
curl https://api.zkvote.io/voting/panic/status
```

### 6. Post-Incident (Within 24h)

- [ ] Blameless retrospective
- [ ] Update fee surge thresholds if needed
- [ ] Document lessons learned
- [ ] Review panic justification

## Escalation

- **If panic > 2 hours**: Notify CEO
- **If compromise confirmed**: Follow security incident playbook
- **If fees remain high**: Contact Stellar Foundation

## SLO During Event

- Vote success rate: > 0% (panic halts all votes)
- Recovery time: < 2 hours from fee stabilization
- Support response: < 15 minutes

## Related Runbooks

- Key Rotation Under Load
- Three-Way Fault Response
- Election Extension Procedure
