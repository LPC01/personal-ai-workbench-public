import { describe, expect, it } from 'vitest';
import { AppError, ERROR_CODES, ERROR_HTTP_STATUS, toErrorResponse } from '../errors.js';

const EXPECTED_HTTP: Record<string, number> = {
  PROJECT_NOT_FOUND: 404,
  PROJECT_ALREADY_EXISTS: 409,
  PROJECT_IN_USE: 409,
  MANIFEST_INVALID: 422,
  PATH_OUTSIDE_ROOT: 403,
  COMMAND_NOT_REGISTERED: 404,
  COMMAND_ARGUMENT_INVALID: 422,
  RUN_NOT_FOUND: 404,
  RUN_STATE_CONFLICT: 409,
  RUN_NOT_CANCELABLE: 409,
  ARTIFACT_NOT_FOUND: 404,
  PORT_UNAVAILABLE: 409,
  HEALTH_CHECK_FAILED: 503,
  APPROVAL_REQUIRED: 409,
  APPROVAL_NOT_FOUND: 404,
  MODEL_CAPABILITY_MISMATCH: 422,
  MODEL_PROVIDER_NOT_FOUND: 404,
  MODEL_PROFILE_NOT_FOUND: 404,
  ROOM_NOT_FOUND: 404,
  ROOM_RUN_NOT_FOUND: 404,
  ROOM_MANIFEST_INVALID: 422,
  AGENT_PROFILE_NOT_FOUND: 404,
  AGENT_SESSION_NOT_FOUND: 404,
  ROOM_PROTOCOL_UNSUPPORTED: 422,
  ROOM_RUN_STATE_CONFLICT: 409,
  ROOM_BUDGET_EXCEEDED: 409,
  PARTICIPANT_NOT_ALLOWED: 403,
  AGENT_PROFILE_MISMATCH: 422,
  AGENT_SESSION_ISOLATION_VIOLATION: 403,
  HANDOFF_TARGET_INVALID: 422,
  EVIDENCE_REQUIRED: 422,
  BALLOT_CONFLICT_OF_INTEREST: 422,
  DECISION_GATE_FAILED: 409,
  ROOM_PROJECT_SCOPE_DENIED: 403,
  CREDENTIAL_INVALID: 401,
  CLOUD_EGRESS_DENIED: 403,
  EXTENSION_PERMISSION_DENIED: 403,
  HARNESS_PROFILE_NOT_FOUND: 404,
  HARNESS_SESSION_NOT_FOUND: 404,
  HARNESS_UNAVAILABLE: 503,
  STUDIO_SESSION_NOT_FOUND: 404,
  EXTENSION_DRAFT_NOT_FOUND: 404,
  EXTENSION_NOT_FOUND: 404,
  EXTENSION_VERSION_NOT_FOUND: 404,
  EXTENSION_NOT_INSTALLABLE: 409,
  EXTENSION_ROLLBACK_UNAVAILABLE: 409,
  ISSUE_NOT_FOUND: 404,
  MEMORY_SCOPE_DENIED: 403,
  MEMORY_SECRET_REJECTED: 422,
  MEMORY_PROVIDER_UNAVAILABLE: 503,
  BACKUP_INVALID: 422,
  DISK_QUOTA_EXCEEDED: 507,
  CREDENTIAL_NOT_FOUND: 404,
  CREDENTIAL_ACCESS_DENIED: 403,
  CREDENTIAL_STORE_UNAVAILABLE: 503,
};

describe('error codes', () => {
  it('maps all 55 codes (16 SPEC §17 + 39 implementation extensions) to their HTTP status', () => {
    expect(Object.keys(ERROR_CODES)).toHaveLength(55);
    expect(ERROR_HTTP_STATUS).toEqual(EXPECTED_HTTP);
  });
});

describe('AppError', () => {
  it('carries code, httpStatus, details and requestId', () => {
    const err = new AppError('RUN_STATE_CONFLICT', '当前状态不允许该操作', {
      details: { from: 'RUNNING', to: 'CANCELLED' },
      requestId: 'req_abc',
    });
    expect(err.code).toBe('RUN_STATE_CONFLICT');
    expect(err.httpStatus).toBe(409);
    expect(err.message).toBe('当前状态不允许该操作');
    expect(err.details).toEqual({ from: 'RUNNING', to: 'CANCELLED' });
    expect(err.requestId).toBe('req_abc');
  });
});

describe('toErrorResponse', () => {
  it('serializes to SPEC §10 format', () => {
    const err = new AppError('PROJECT_NOT_FOUND', '项目不存在', { details: { id: 'p1' } });
    expect(toErrorResponse(err, 'req_fallback')).toEqual({
      error: {
        code: 'PROJECT_NOT_FOUND',
        message: '项目不存在',
        details: { id: 'p1' },
        requestId: 'req_fallback',
      },
    });
  });

  it('prefers the error-level requestId over the fallback', () => {
    const err = new AppError('MANIFEST_INVALID', 'x', { requestId: 'req_err' });
    expect(toErrorResponse(err, 'req_fallback').error.requestId).toBe('req_err');
  });
});
