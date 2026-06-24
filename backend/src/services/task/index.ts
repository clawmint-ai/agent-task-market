// Barrel for the task service, split across mappers/queries/lifecycle/settlement.
// Re-exports everything the routes layer imported from the old taskService.ts.
export type { Task, TaskExecution } from './mappers';
export {
  listTasks,
  getTaskById,
  getTaskVerificationDetail,
  getExecutionDetail,
  getMyExecutions,
  getTaskSubmissions,
  getMyPublished,
} from './queries';
export { createTask, claimTask, submitResult } from './lifecycle';
export { verifyResult, finalizeExecution, reclaimExpiredTasks, releaseStaleClaims, releaseStaleClaimsForTask, STALE_CLAIM_MS } from './settlement';
