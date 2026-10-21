/**
 * DAO Factory Saga Orchestrator
 * Manages transactional DAO creation with compensation logic
 */

import { v4 as uuidv4 } from 'uuid'
import { createLogger } from './logger.js'

const logger = createLogger('factory-orchestrator')

export enum FactoryStep {
  VALIDATE_INPUT = 1,
  RESERVE_NAME = 2,
  CREATE_REGISTRY = 3,
  DEPLOY_MEMBERSHIP_SBT = 4,
  DEPLOY_MEMBERSHIP_TREE = 5,
  DEPLOY_VOTING = 6,
  DEPLOY_COMMENTS = 7,
  INITIALIZE_TREASURY = 8,
  REGISTER_SEARCH = 9,
  VERIFY_FIRST_VOTE = 10,
  COMPLETE = 11
}

export enum FactoryStatus {
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FAILED = 'failed',
  COMPENSATING = 'compensating',
  COMPENSATED = 'compensated'
}

export interface DAOCreationParams {
  name: string
  description: string
  creator: string
  treasuryTier: 'basic' | 'standard' | 'advanced'
  initialFunding: number
  votingPolicy?: {
    quorum: number
    passingThreshold: number
  }
}

export interface FactorySaga {
  ticketId: string
  creator: string
  daoName: string
  currentStep: FactoryStep
  deployedContracts: string[]
  compensationLedger: CompensationAction[]
  status: FactoryStatus
  createdAt: Date
  updatedAt: Date
  error?: string
}

export interface CompensationAction {
  step: FactoryStep
  action: string
  contractAddress?: string
  executed: boolean
  timestamp: Date
}

export class FactoryOrchestrator {
  private sagas: Map<string, FactorySaga> = new Map()

  /**
   * Start DAO creation saga
   */
  async createDAO(params: DAOCreationParams): Promise<string> {
    const ticketId = uuidv4()
    const saga: FactorySaga = {
      ticketId,
      creator: params.creator,
      daoName: params.name,
      currentStep: FactoryStep.VALIDATE_INPUT,
      deployedContracts: [],
      compensationLedger: [],
      status: FactoryStatus.IN_PROGRESS,
      createdAt: new Date(),
      updatedAt: new Date()
    }

    this.sagas.set(ticketId, saga)

    // Execute saga asynchronously
    this.executeSaga(ticketId, params).catch(error => {
      console.error(`Saga ${ticketId} failed:`, error)
      this.handleSagaFailure(ticketId, error)
    })

    return ticketId
  }

  /**
   * Get saga status
   */
  getStatus(ticketId: string): FactorySaga | undefined {
    return this.sagas.get(ticketId)
  }

  /**
   * Resume failed saga
   */
  async resume(ticketId: string): Promise<void> {
    const saga = this.sagas.get(ticketId)
    if (!saga || saga.status !== FactoryStatus.FAILED) {
      throw new Error('Cannot resume saga')
    }

    saga.status = FactoryStatus.IN_PROGRESS
    saga.updatedAt = new Date()

    // Resume from current step
    const params = this.reconstructParams(saga)
    await this.executeSaga(ticketId, params)
  }

  /**
   * Cancel saga and compensate
   */
  async cancel(ticketId: string): Promise<void> {
    const saga = this.sagas.get(ticketId)
    if (!saga) {
      throw new Error('Saga not found')
    }

    saga.status = FactoryStatus.COMPENSATING
    await this.compensate(ticketId)
    saga.status = FactoryStatus.COMPENSATED
  }

  /**
   * Execute saga steps
   */
  private async executeSaga(ticketId: string, params: DAOCreationParams): Promise<void> {
    const saga = this.sagas.get(ticketId)!
    const steps = [
      { step: FactoryStep.VALIDATE_INPUT, fn: this.validateInput },
      { step: FactoryStep.RESERVE_NAME, fn: this.reserveName },
      { step: FactoryStep.CREATE_REGISTRY, fn: this.createRegistry },
      { step: FactoryStep.DEPLOY_MEMBERSHIP_SBT, fn: this.deployMembershipSBT },
      { step: FactoryStep.DEPLOY_MEMBERSHIP_TREE, fn: this.deployMembershipTree },
      { step: FactoryStep.DEPLOY_VOTING, fn: this.deployVoting },
      { step: FactoryStep.DEPLOY_COMMENTS, fn: this.deployComments },
      { step: FactoryStep.INITIALIZE_TREASURY, fn: this.initializeTreasury },
      { step: FactoryStep.REGISTER_SEARCH, fn: this.registerSearch },
      { step: FactoryStep.VERIFY_FIRST_VOTE, fn: this.verifyFirstVote },
      { step: FactoryStep.COMPLETE, fn: this.markComplete }
    ]

    for (const { step, fn } of steps) {
      if (saga.currentStep > step) {
        continue // Skip already completed steps
      }

      saga.currentStep = step
      saga.updatedAt = new Date()

      try {
        await fn.call(this, ticketId, params)
      } catch (error) {
        saga.error = (error as Error).message
        throw error
      }
    }
  }

  /**
   * Step implementations
   */
  private async validateInput(ticketId: string, params: DAOCreationParams): Promise<void> {
    logger.info('factory_step', { ticketId, step: 'validate_input' })
    
    // Name validation
    if (params.name.length < 3 || params.name.length > 32) {
      throw new Error('DAO name must be 3-32 characters')
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(params.name)) {
      throw new Error('DAO name contains invalid characters')
    }

    // Funding validation
    if (params.initialFunding < 100) {
      throw new Error('Minimum funding is 100 XLM')
    }

    await this.sleep(500)
  }

  private async reserveName(ticketId: string, params: DAOCreationParams): Promise<void> {
    logger.info('factory_step', { ticketId, step: 'reserve_name', name: params.name })
    
    // Check name availability
    // In production, would interact with registry contract
    
    const saga = this.sagas.get(ticketId)!
    saga.compensationLedger.push({
      step: FactoryStep.RESERVE_NAME,
      action: 'release_name_reservation',
      executed: false,
      timestamp: new Date()
    })

    await this.sleep(1000)
  }

  private async createRegistry(ticketId: string, params: DAOCreationParams): Promise<void> {
    logger.info('factory_step', { ticketId, step: 'create_registry' })
    
    // Deploy or call registry contract
    const mockContractId = `registry_${params.name}_${Date.now()}`
    
    const saga = this.sagas.get(ticketId)!
    saga.deployedContracts.push(mockContractId)
    saga.compensationLedger.push({
      step: FactoryStep.CREATE_REGISTRY,
      action: 'delete_registry_entry',
      contractAddress: mockContractId,
      executed: false,
      timestamp: new Date()
    })

    await this.sleep(2000)
  }

  private async deployMembershipSBT(ticketId: string, params: DAOCreationParams): Promise<void> {
    logger.info('factory_step', { ticketId, step: 'deploy_membership_sbt' })
    
    const mockContractId = `sbt_${params.name}_${Date.now()}`
    
    const saga = this.sagas.get(ticketId)!
    saga.deployedContracts.push(mockContractId)
    saga.compensationLedger.push({
      step: FactoryStep.DEPLOY_MEMBERSHIP_SBT,
      action: 'cleanup_sbt_contract',
      contractAddress: mockContractId,
      executed: false,
      timestamp: new Date()
    })

    await this.sleep(3000)
  }

  private async deployMembershipTree(ticketId: string, params: DAOCreationParams): Promise<void> {
    logger.info('factory_step', { ticketId, step: 'deploy_membership_tree' })
    
    const mockContractId = `tree_${params.name}_${Date.now()}`
    
    const saga = this.sagas.get(ticketId)!
    saga.deployedContracts.push(mockContractId)
    saga.compensationLedger.push({
      step: FactoryStep.DEPLOY_MEMBERSHIP_TREE,
      action: 'cleanup_tree_contract',
      contractAddress: mockContractId,
      executed: false,
      timestamp: new Date()
    })

    await this.sleep(3000)
  }

  private async deployVoting(ticketId: string, params: DAOCreationParams): Promise<void> {
    logger.info('factory_step', { ticketId, step: 'deploy_voting' })
    
    const mockContractId = `voting_${params.name}_${Date.now()}`
    
    const saga = this.sagas.get(ticketId)!
    saga.deployedContracts.push(mockContractId)
    saga.compensationLedger.push({
      step: FactoryStep.DEPLOY_VOTING,
      action: 'cleanup_voting_contract',
      contractAddress: mockContractId,
      executed: false,
      timestamp: new Date()
    })

    await this.sleep(3000)
  }

  private async deployComments(ticketId: string, params: DAOCreationParams): Promise<void> {
    logger.info('factory_step', { ticketId, step: 'deploy_comments' })
    
    const mockContractId = `comments_${params.name}_${Date.now()}`
    
    const saga = this.sagas.get(ticketId)!
    saga.deployedContracts.push(mockContractId)

    await this.sleep(2000)
  }

  private async initializeTreasury(ticketId: string, params: DAOCreationParams): Promise<void> {
    logger.info('factory_step', { ticketId, step: 'init_treasury', tier: params.treasuryTier })
    await this.sleep(2000)
  }

  private async registerSearch(ticketId: string, params: DAOCreationParams): Promise<void> {
    logger.info('factory_step', { ticketId, step: 'register_search_index' })
    await this.sleep(1000)
  }

  private async verifyFirstVote(ticketId: string, params: DAOCreationParams): Promise<void> {
    logger.info('factory_step', { ticketId, step: 'verify_first_vote' })
    
    // Execute automated first vote drill
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.runFirstVoteDrill(ticketId)
        return
      } catch (error) {
        console.warn(`First vote attempt ${attempt + 1} failed:`, error)
        if (attempt === 2) throw error
        await this.sleep(2000)
      }
    }
  }

  private async markComplete(ticketId: string, params: DAOCreationParams): Promise<void> {
    logger.info('factory_complete', { ticketId })
    const saga = this.sagas.get(ticketId)!
    saga.status = FactoryStatus.COMPLETED
    saga.updatedAt = new Date()
  }

  /**
   * Compensation logic
   */
  private async compensate(ticketId: string): Promise<void> {
    const saga = this.sagas.get(ticketId)!
    logger.warn('factory_compensating', { ticketId })

    // Execute compensation actions in reverse order
    const actions = [...saga.compensationLedger].reverse()
    for (const action of actions) {
      if (!action.executed) {
        logger.warn('factory_compensation_action', { ticketId, action: action.action })
        // In production, would call actual cleanup functions
        action.executed = true
        await this.sleep(500)
      }
    }
  }

  private async handleSagaFailure(ticketId: string, error: Error): Promise<void> {
    const saga = this.sagas.get(ticketId)!
    saga.status = FactoryStatus.FAILED
    saga.error = error.message
    saga.updatedAt = new Date()
  }

  private async runFirstVoteDrill(ticketId: string): Promise<void> {
    // Simulate first vote test
    await this.sleep(3000)
  }

  private reconstructParams(saga: FactorySaga): DAOCreationParams {
    // Reconstruct params from saga state
    return {
      name: saga.daoName,
      description: '',
      creator: saga.creator,
      treasuryTier: 'basic',
      initialFunding: 100
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

export const factoryOrchestrator = new FactoryOrchestrator()
