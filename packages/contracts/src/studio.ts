import type { ExtensionSpec } from './extension.js';

/** Studio 会话状态。 */
export type StudioSessionStatus = 'active' | 'spec-generated' | 'closed';

/** Studio 会话（26 SPEC §10.3 + 设计 §6.6）：承载需求对话。 */
export interface StudioSession {
  id: string;
  title: string;
  status: StudioSessionStatus;
  createdAt: string;
  updatedAt: string;
}

/** Studio 消息角色。 */
export type StudioMessageRole = 'user' | 'assistant';

/** Studio 消息。 */
export interface StudioMessage {
  id: string;
  sessionId: string;
  role: StudioMessageRole;
  content: string;
  createdAt: string;
}

/** 扩展草稿状态（设计 §3.4：草稿与正式资产分离）。 */
export type ExtensionDraftStatus = 'draft' | 'confirmed' | 'published';

/** 扩展草稿：从需求生成的版本化 Extension Spec 草稿。 */
export interface ExtensionDraft {
  id: string;
  sessionId: string;
  spec: ExtensionSpec;
  status: ExtensionDraftStatus;
  createdAt: string;
  updatedAt: string;
}
