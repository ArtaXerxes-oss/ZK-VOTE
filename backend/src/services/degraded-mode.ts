/**
 * Degraded Mode Service
 * Manages graceful degradation during combined fault scenarios
 */

export enum DegradationLevel {
  NORMAL = 0,
  SLIGHT = 1,
  MODERATE = 2,
  SEVERE = 3,
  CRITICAL = 4
}

export interface DegradationState {
  level: DegradationLevel
  activeReasons: string[]
  startedAt: Date
  expectedRecovery?: Date
}

export class DegradedModeService {
  private currentLevel: DegradationLevel = DegradationLevel.NORMAL
  private activeReasons: Set<string> = new Set()
  private degradationStartTime?: Date

  /**
   * Trigger degradation for a specific reason
   */
  triggerDegradation(reason: string, level: DegradationLevel): void {
    this.activeReasons.add(reason)
    
    if (level > this.currentLevel) {
      this.currentLevel = level
      if (!this.degradationStartTime) {
        this.degradationStartTime = new Date()
      }
      console.warn(`Degradation level increased to ${DegradationLevel[level]} due to: ${reason}`)
    }
  }

  /**
   * Clear degradation for a specific reason
   */
  clearDegradation(reason: string): void {
    this.activeReasons.delete(reason)
    
    if (this.activeReasons.size === 0) {
      this.currentLevel = DegradationLevel.NORMAL
      this.degradationStartTime = undefined
      console.info('System recovered to normal operation')
    } else {
      this.recalculateLevel()
    }
  }

  /**
   * Get current degradation state
   */
  getState(): DegradationState {
    return {
      level: this.currentLevel,
      activeReasons: Array.from(this.activeReasons),
      startedAt: this.degradationStartTime || new Date(),
      expectedRecovery: this.estimateRecovery()
    }
  }

  /**
   * Check if a feature should be available at current degradation level
   */
  isFeatureAvailable(feature: string): boolean {
    const requirements = FEATURE_REQUIREMENTS[feature] || DegradationLevel.NORMAL
    return this.currentLevel <= requirements
  }

  /**
   * Get rate limit multiplier based on degradation level
   */
  getRateLimitMultiplier(): number {
    switch (this.currentLevel) {
      case DegradationLevel.NORMAL:
        return 1.0
      case DegradationLevel.SLIGHT:
        return 0.8
      case DegradationLevel.MODERATE:
        return 0.5
      case DegradationLevel.SEVERE:
        return 0.3
      case DegradationLevel.CRITICAL:
        return 0.1
      default:
        return 1.0
    }
  }

  /**
   * Get timeout multiplier for operations
   */
  getTimeoutMultiplier(): number {
    switch (this.currentLevel) {
      case DegradationLevel.NORMAL:
        return 1.0
      case DegradationLevel.SLIGHT:
        return 1.5
      case DegradationLevel.MODERATE:
        return 2.0
      case DegradationLevel.SEVERE:
        return 3.0
      case DegradationLevel.CRITICAL:
        return 5.0
      default:
        return 1.0
    }
  }

  /**
   * Get retry strategy for current level
   */
  getRetryStrategy(): { maxRetries: number; backoffMs: number } {
    switch (this.currentLevel) {
      case DegradationLevel.NORMAL:
        return { maxRetries: 3, backoffMs: 1000 }
      case DegradationLevel.SLIGHT:
        return { maxRetries: 5, backoffMs: 2000 }
      case DegradationLevel.MODERATE:
        return { maxRetries: 7, backoffMs: 3000 }
      case DegradationLevel.SEVERE:
        return { maxRetries: 10, backoffMs: 5000 }
      case DegradationLevel.CRITICAL:
        return { maxRetries: 15, backoffMs: 10000 }
      default:
        return { maxRetries: 3, backoffMs: 1000 }
    }
  }

  /**
   * Should queue operation instead of executing immediately?
   */
  shouldQueue(operationType: string): boolean {
    if (this.currentLevel <= DegradationLevel.SLIGHT) {
      return false
    }

    const criticalOps = ['vote_submission', 'tally_verification']
    return !criticalOps.includes(operationType)
  }

  private recalculateLevel(): void {
    // In a real implementation, would evaluate all active reasons
    // and determine appropriate degradation level
    const reasons = Array.from(this.activeReasons)
    if (reasons.length === 0) {
      this.currentLevel = DegradationLevel.NORMAL
    } else if (reasons.some(r => r.includes('panic') || r.includes('critical'))) {
      this.currentLevel = DegradationLevel.CRITICAL
    } else if (reasons.some(r => r.includes('rotation') || r.includes('surge'))) {
      this.currentLevel = DegradationLevel.SEVERE
    } else {
      this.currentLevel = DegradationLevel.MODERATE
    }
  }

  private estimateRecovery(): Date | undefined {
    if (!this.degradationStartTime) {
      return undefined
    }

    // Simple estimation - would be more sophisticated in production
    const hoursToRecover = this.currentLevel * 0.5
    const recovery = new Date(this.degradationStartTime)
    recovery.setHours(recovery.getHours() + hoursToRecover)
    return recovery
  }
}

// Feature availability requirements
const FEATURE_REQUIREMENTS: Record<string, DegradationLevel> = {
  'vote_submission': DegradationLevel.CRITICAL,
  'tally_verification': DegradationLevel.CRITICAL,
  'membership_registration': DegradationLevel.SEVERE,
  'dao_creation': DegradationLevel.MODERATE,
  'comment_submission': DegradationLevel.SLIGHT,
  'search': DegradationLevel.SLIGHT,
  'analytics': DegradationLevel.NORMAL
}

// Singleton instance
export const degradedMode = new DegradedModeService()
