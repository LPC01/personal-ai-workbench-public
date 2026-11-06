import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { AppError } from '@workbench/domain';
import type {
  CredentialDescriptor,
  CredentialInput,
  CredentialPurpose,
  CredentialType,
  SecretMaterial,
} from '@workbench/contracts';

/**
 * 凭据存储（32 号 SPEC §3.2 CRED）。
 * 闭包式最短生命周期：Secret 只经 `withSecret` 闭包使用，绝不作为普通值传播、序列化、记录或返回 API。
 */
export interface CredentialStore {
  /** 写入 Secret，返回 descriptor（不含 Secret）。 */
  put(input: CredentialInput): Promise<CredentialDescriptor>;
  /** 返回 descriptor（不含 Secret）。 */
  describe(ref: string): Promise<CredentialDescriptor>;
  /** 在最短生命周期内以闭包使用 Secret；禁止在闭包外持有或传播。 */
  withSecret<T>(
    ref: string,
    purpose: CredentialPurpose,
    use: (secret: SecretMaterial) => Promise<T>,
  ): Promise<T>;
  /** 删除凭据并审计。 */
  delete(ref: string): Promise<void>;
}

/** 掩码：只暴露末尾 4 位，短于 5 位则全掩。 */
export function maskSecret(secret: string): string {
  if (secret.length <= 4) {
    return '****';
  }
  return `****${secret.slice(-4)}`;
}

interface StoredEntry {
  type: CredentialType;
  secret: string;
  createdAt: string;
}

function descriptorOf(ref: string, entry: StoredEntry): CredentialDescriptor {
  return {
    ref,
    type: entry.type,
    masked: maskSecret(entry.secret),
    createdAt: entry.createdAt,
    updatedAt: entry.createdAt,
    status: 'ACTIVE',
  };
}

/** 内存实现：用于测试与非 Windows 环境（Mock）。 */
export class InMemoryCredentialStore implements CredentialStore {
  private readonly map = new Map<string, StoredEntry>();

  async put(input: CredentialInput): Promise<CredentialDescriptor> {
    const ref = input.ref ?? `cred_${randomUUID()}`;
    const entry: StoredEntry = {
      type: input.type,
      secret: input.secret,
      createdAt: new Date().toISOString(),
    };
    this.map.set(ref, entry);
    return descriptorOf(ref, entry);
  }

  async describe(ref: string): Promise<CredentialDescriptor> {
    const entry = this.map.get(ref);
    if (!entry) {
      throw new AppError('CREDENTIAL_NOT_FOUND', '凭据不存在或已删除', { details: { ref } });
    }
    return descriptorOf(ref, entry);
  }

  async withSecret<T>(
    ref: string,
    _purpose: CredentialPurpose,
    use: (secret: SecretMaterial) => Promise<T>,
  ): Promise<T> {
    const entry = this.map.get(ref);
    if (!entry) {
      throw new AppError('CREDENTIAL_NOT_FOUND', '凭据不存在或已删除', { details: { ref } });
    }
    return use(entry.secret);
  }

  async delete(ref: string): Promise<void> {
    this.map.delete(ref);
  }
}

function runPowerShell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`powershell 失败（exit ${code}）: ${stderr || stdout}`));
      }
    });
  });
}

/** DPAPI（Windows Data Protection API，CurrentUser 作用域）加密，返回 Base64。 */
async function dpapiProtect(secret: string): Promise<string> {
  const tmpIn = join(tmpdir(), `wb-dpapi-in-${randomUUID()}.txt`);
  writeFileSync(tmpIn, secret, 'utf8');
  try {
    const script =
      'Add-Type -AssemblyName System.Security; ' +
      `$b = [IO.File]::ReadAllBytes('${tmpIn.replaceAll("'", "''")}'); ` +
      '$p = [Security.Cryptography.ProtectedData]::Protect($b, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser); ' +
      '[Console]::Write([Convert]::ToBase64String($p));';
    return await runPowerShell(script);
  } finally {
    rmSync(tmpIn, { force: true });
  }
}

/** DPAPI 解密 Base64，返回明文。 */
async function dpapiUnprotect(encB64: string): Promise<string> {
  const script =
    'Add-Type -AssemblyName System.Security; ' +
    `$b = [Convert]::FromBase64String('${encB64}'); ` +
    '$p = [Security.Cryptography.ProtectedData]::Unprotect($b, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser); ' +
    '[Console]::Write([Text.Encoding]::UTF8.GetString($p));';
  return await runPowerShell(script);
}

interface WindowsCredentialFile {
  type: CredentialType;
  encrypted: string;
  masked: string;
  createdAt: string;
}

/**
 * Windows 实现：Secret 用 DPAPI（CurrentUser）加密后落盘，目录默认 `${WB_DATA_DIR}/credentials`。
 * 与旧 cmdkey 方案不同：支持 `withSecret` 真实回读，实现服务端安全解析闭环。
 */
export class WindowsCredentialStore implements CredentialStore {
  private readonly dir: string;

  constructor(dataDir?: string) {
    this.dir = join(dataDir ?? process.env.WB_DATA_DIR ?? 'var', 'credentials');
    mkdirSync(this.dir, { recursive: true });
  }

  private filePath(ref: string): string {
    return join(this.dir, `${ref}.json`);
  }

  private read(ref: string): WindowsCredentialFile {
    const path = this.filePath(ref);
    if (!existsSync(path)) {
      throw new AppError('CREDENTIAL_NOT_FOUND', '凭据不存在或已删除', { details: { ref } });
    }
    return JSON.parse(readFileSync(path, 'utf8')) as WindowsCredentialFile;
  }

  async put(input: CredentialInput): Promise<CredentialDescriptor> {
    const ref = input.ref ?? `cred_${randomUUID()}`;
    const encrypted = await dpapiProtect(input.secret);
    const file: WindowsCredentialFile = {
      type: input.type,
      encrypted,
      masked: maskSecret(input.secret),
      createdAt: new Date().toISOString(),
    };
    writeFileSync(this.filePath(ref), JSON.stringify(file), 'utf8');
    return {
      ref,
      type: input.type,
      masked: file.masked,
      createdAt: file.createdAt,
      updatedAt: file.createdAt,
      status: 'ACTIVE',
    };
  }

  async describe(ref: string): Promise<CredentialDescriptor> {
    const file = this.read(ref);
    return {
      ref,
      type: file.type,
      masked: file.masked,
      createdAt: file.createdAt,
      updatedAt: file.createdAt,
      status: 'ACTIVE',
    };
  }

  async withSecret<T>(
    ref: string,
    _purpose: CredentialPurpose,
    use: (secret: SecretMaterial) => Promise<T>,
  ): Promise<T> {
    const file = this.read(ref);
    const secret = await dpapiUnprotect(file.encrypted);
    return use(secret);
  }

  async delete(ref: string): Promise<void> {
    const path = this.filePath(ref);
    if (existsSync(path)) {
      rmSync(path, { force: true });
    }
  }
}
