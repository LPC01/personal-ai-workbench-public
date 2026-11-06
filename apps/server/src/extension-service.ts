import { AppError } from '@workbench/domain';
import { computePermissionDiff } from '@workbench/contracts';
import type { ExtensionPermissions, PermissionDiff } from '@workbench/contracts';
import type {
  ExtensionRecord,
  ExtensionStore,
  ExtensionVersionRecord,
} from '@workbench/persistence';

const EMPTY_PERMISSIONS: ExtensionPermissions = {
  files: { read: [], write: [] },
  commands: [],
  network: false,
  credentials: [],
};

export interface InstallResult {
  version: ExtensionVersionRecord;
  permissionDiff: PermissionDiff;
  /** 权限扩大（升级时）需人工重新批准。 */
  requiresApproval: boolean;
}

/**
 * 扩展生命周期服务（26 SPEC §10.3 + §6）：不可变安装、启用、升级、回滚。
 * 升级/启用时计算权限差异；权限扩大返回 requiresApproval（P5-08 联动审批）。
 */
export class ExtensionService {
  constructor(private readonly store: ExtensionStore) {}

  listExtensions(): ExtensionRecord[] {
    return this.store.listExtensions();
  }

  /** 安装指定版本（published→installed）；返回权限差异。 */
  install(extensionId: string, version: string): InstallResult {
    const ext = this.requireExtension(extensionId);
    const target = this.findVersion(extensionId, version);
    if (target.status === 'draft') {
      throw new AppError('EXTENSION_NOT_INSTALLABLE', `版本 ${version} 未发布，不可安装`, {
        details: { extensionId, version },
      });
    }
    const current = ext.enabledVersionId ? this.store.getVersion(ext.enabledVersionId) : undefined;
    const permissionDiff = this.diff(current?.permissions, target.permissions);
    const installed = this.store.installVersion(target.id);
    return {
      version: installed,
      permissionDiff,
      requiresApproval: current ? permissionDiff.expanded : false,
    };
  }

  /** 启用指定版本；返回权限差异。 */
  enable(extensionId: string, version: string): InstallResult {
    const ext = this.requireExtension(extensionId);
    const target = this.findVersion(extensionId, version);
    const current = ext.enabledVersionId ? this.store.getVersion(ext.enabledVersionId) : undefined;
    const permissionDiff = this.diff(current?.permissions, target.permissions);
    this.store.enableVersion(extensionId, target.id);
    return {
      version: target,
      permissionDiff,
      requiresApproval: current ? permissionDiff.expanded : false,
    };
  }

  /** 回滚到上一个已安装版本。 */
  rollback(extensionId: string): ExtensionRecord {
    this.requireExtension(extensionId);
    try {
      return this.store.rollback(extensionId);
    } catch (error) {
      throw new AppError('EXTENSION_ROLLBACK_UNAVAILABLE', (error as Error).message, {
        details: { extensionId },
      });
    }
  }

  private diff(from: ExtensionPermissions | undefined, to: ExtensionPermissions): PermissionDiff {
    return computePermissionDiff(from ?? EMPTY_PERMISSIONS, to);
  }

  private requireExtension(extensionId: string): ExtensionRecord {
    const ext = this.store.getExtension(extensionId);
    if (!ext) {
      throw new AppError('EXTENSION_NOT_FOUND', '扩展不存在', { details: { extensionId } });
    }
    return ext;
  }

  private findVersion(extensionId: string, version: string): ExtensionVersionRecord {
    const found = this.store.listVersions(extensionId).find((v) => v.version === version);
    if (!found) {
      throw new AppError('EXTENSION_VERSION_NOT_FOUND', '版本不存在', {
        details: { extensionId, version },
      });
    }
    return found;
  }
}
