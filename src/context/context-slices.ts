/** @module context-slices — Narrowed AppContext slices for dependency-injected access to approval, job, and session state */
import type { AppContext } from './app-context.js';

type Slice<K extends keyof AppContext> = Pick<AppContext, K>;

export type ApprovalSlice = Slice<
  'pendingConfirmations' | 'pendingToolApprovals' | 'pendingMcpAuthBypassApprovals'
>;

export type JobLifecycleSlice = Slice<
  'sessionManager' | 'jobQueue' | 'workdirManager' | 'activeRunners'
>;

export type SessionLookupSlice = Slice<'sessionManager'>;
