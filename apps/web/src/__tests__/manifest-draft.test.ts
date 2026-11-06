import { describe, expect, it } from 'vitest';
import {
  PROJECT_SCHEMA_ID,
  buildManifest,
  detectUnmappedBlocks,
  draftFromManifest,
  emptyDraft,
  isAbsolutePath,
  parseArguments,
  validateDraft,
  type ManifestDraft,
} from '../manifest-draft';

/** 关闭全部可选区块的草稿：用于验证「最小可用 manifest」。 */
function minimalDraft(): ManifestDraft {
  return {
    ...emptyDraft(),
    id: 'my-app',
    name: '我的应用',
    root: 'C:/Projects/my-app',
    portEnabled: false,
    commandEnabled: false,
    webUIEnabled: false,
  };
}

/** 真实清单里的一条（scripts/projects.registry.json 的示例服务）。 */
const REGISTRY_MANIFEST = {
  schemaVersion: 'workbench.project/v1',
  project: {
    id: 'demo-service',
    name: '示例服务',
    description: 'Node http 静态服务；读 PORT 环境变量',
  },
  runtime: {
    root: 'C:/Projects/demo-service',
    port: { strategy: 'dynamic', from: 8120, to: 8129, environmentVariable: 'PORT' },
  },
  webUI: {
    enabled: true,
    displayMode: 'proxy',
    startCommandId: 'start',
    url: 'http://127.0.0.1:${port}/',
    healthCheck: { type: 'http', url: 'http://127.0.0.1:${port}/', timeoutSeconds: 20 },
  },
  commands: [
    {
      id: 'start',
      type: 'service',
      executable: 'node',
      arguments: ['server.mjs'],
      concurrency: 'singleton',
    },
  ],
};

describe('manifest-draft：组装 buildManifest', () => {
  it('最小草稿只输出 schemaVersion / project / runtime.root', () => {
    expect(buildManifest(minimalDraft())).toEqual({
      schemaVersion: PROJECT_SCHEMA_ID,
      project: { id: 'my-app', name: '我的应用' },
      runtime: { root: 'C:/Projects/my-app' },
    });
  });

  it('未启用的区块不输出（对齐 additionalProperties:false）', () => {
    const manifest = buildManifest(minimalDraft());
    expect(manifest).not.toHaveProperty('commands');
    expect(manifest).not.toHaveProperty('webUI');
    expect(manifest.runtime).not.toHaveProperty('port');
  });

  it('描述为空时 project 不含 description 键', () => {
    const manifest = buildManifest(minimalDraft());
    expect(manifest.project).not.toHaveProperty('description');
  });

  it('默认草稿产出的键集合落在 Schema 允许范围内', () => {
    const manifest = buildManifest({
      ...emptyDraft(),
      id: 'my-app',
      name: '我的应用',
      root: 'C:/Projects/my-app',
    });
    expect(Object.keys(manifest).sort()).toEqual(
      ['commands', 'project', 'runtime', 'schemaVersion', 'webUI'].sort(),
    );
    expect(Object.keys(manifest.project as object).sort()).toEqual(['id', 'name']);
    expect(Object.keys(manifest.runtime as object).sort()).toEqual(['port', 'root']);
    expect(Object.keys((manifest.runtime as { port: object }).port).sort()).toEqual([
      'environmentVariable',
      'from',
      'strategy',
      'to',
    ]);
    expect(Object.keys((manifest.commands as object[])[0] as object).sort()).toEqual([
      'arguments',
      'concurrency',
      'executable',
      'id',
      'type',
    ]);
    expect(Object.keys(manifest.webUI as object).sort()).toEqual([
      'displayMode',
      'enabled',
      'healthCheck',
      'startCommandId',
    ]);
  });

  it('webUI.startCommandId 与命令 id 联动；无命令时不写悬空引用', () => {
    const withCommand = buildManifest({
      ...emptyDraft(),
      id: 'my-app',
      name: 'A',
      root: 'C:/Projects/a',
      commandId: 'serve',
    });
    expect((withCommand.webUI as { startCommandId?: string }).startCommandId).toBe('serve');

    const withoutCommand = buildManifest({
      ...emptyDraft(),
      id: 'my-app',
      name: 'A',
      root: 'C:/Projects/a',
      commandEnabled: false,
    });
    expect(withoutCommand.webUI).not.toHaveProperty('startCommandId');
  });

  it('参数按空白切分，空参数不写 arguments 键', () => {
    const manifest = buildManifest({
      ...emptyDraft(),
      id: 'my-app',
      name: 'A',
      root: 'C:/Projects/a',
      commandArguments: '  --filter   web\n dev ',
    });
    expect((manifest.commands as { arguments: string[] }[])[0]?.arguments).toEqual([
      '--filter',
      'web',
      'dev',
    ]);

    const empty = buildManifest({
      ...emptyDraft(),
      id: 'my-app',
      name: 'A',
      root: 'C:/Projects/a',
      commandArguments: '   ',
    });
    expect((empty.commands as object[])[0]).not.toHaveProperty('arguments');
  });

  it('端口环境变量留空时不写 environmentVariable', () => {
    const manifest = buildManifest({
      ...emptyDraft(),
      id: 'my-app',
      name: 'A',
      root: 'C:/Projects/a',
      portEnvVar: '',
    });
    expect((manifest.runtime as { port: object }).port).not.toHaveProperty('environmentVariable');
  });
});

describe('manifest-draft：本地校验 validateDraft', () => {
  it('默认草稿缺必填 → 报错', () => {
    expect(validateDraft(emptyDraft())).toEqual(['项目 ID 必填', '项目名称必填', '项目根目录必填']);
  });

  it('合法草稿 → 无错误', () => {
    const draft: ManifestDraft = {
      ...emptyDraft(),
      id: 'my-app',
      name: '我的应用',
      root: 'C:/Projects/my-app',
    };
    expect(validateDraft(draft)).toEqual([]);
  });

  it('项目 ID 必须匹配 ^[a-z][a-z0-9-]{2,63}$', () => {
    for (const bad of ['My_App', 'AB', '1abc', 'my app', '']) {
      const errors = validateDraft({ ...emptyDraft(), id: bad, name: 'A', root: 'C:/Projects/a' });
      expect(errors.length, `期望 ${bad} 被拒`).toBeGreaterThan(0);
    }
    expect(
      validateDraft({ ...emptyDraft(), id: 'a-b-c', name: 'A', root: 'C:/Projects/a' }),
    ).toEqual([]);
  });

  it('根目录必须为绝对路径', () => {
    expect(isAbsolutePath('C:/Projects/x')).toBe(true);
    expect(isAbsolutePath('C:\\Projects\\x')).toBe(true);
    expect(isAbsolutePath('/d/x')).toBe(true);
    expect(isAbsolutePath('d/x')).toBe(false);
    expect(isAbsolutePath('./x')).toBe(false);

    const errors = validateDraft({ ...emptyDraft(), id: 'my-app', name: 'A', root: 'd/x' });
    expect(errors).toContain('项目根目录必须是绝对路径（如 C:/Projects/my-app）');
  });

  it('端口段：整数 1–65535 且起点不大于终点', () => {
    const base = { ...emptyDraft(), id: 'my-app', name: 'A', root: 'C:/Projects/a' };
    expect(validateDraft({ ...base, portFrom: '8120', portTo: '8129' })).toEqual([]);
    expect(validateDraft({ ...base, portFrom: '8130', portTo: '8120' })).toContain(
      '端口段起点不能大于终点',
    );
    expect(validateDraft({ ...base, portFrom: '0', portTo: '10' })).toContain(
      '端口段起点需为 1–65535 的整数',
    );
    expect(validateDraft({ ...base, portFrom: '8120', portTo: '70000' })).toContain(
      '端口段终点需为 1–65535 的整数',
    );
    expect(validateDraft({ ...base, portFrom: '8120.5', portTo: '8130' })).toContain(
      '端口段起点需为 1–65535 的整数',
    );
  });

  it('端口环境变量名不合法时提示', () => {
    const base = { ...emptyDraft(), id: 'my-app', name: 'A', root: 'C:/Projects/a' };
    expect(validateDraft({ ...base, portEnvVar: '2PORT' })).toContain(
      '端口环境变量名不合法（应为 PORT 这类标识符）',
    );
    expect(validateDraft({ ...base, portEnvVar: '' })).toEqual([]);
  });

  it('启用命令时命令 ID 与可执行文件必填', () => {
    const base = { ...emptyDraft(), id: 'my-app', name: 'A', root: 'C:/Projects/a' };
    expect(validateDraft({ ...base, commandId: '' })).toContain('启动命令 ID 必填');
    expect(validateDraft({ ...base, commandExecutable: '' })).toContain('启动命令的可执行文件必填');
  });

  it('健康检查 URL 与超时校验', () => {
    const base = { ...emptyDraft(), id: 'my-app', name: 'A', root: 'C:/Projects/a' };
    expect(validateDraft({ ...base, webUIHealthUrl: '127.0.0.1:8100' })).toContain(
      '健康检查 URL 需以 http:// 或 https:// 开头',
    );
    expect(validateDraft({ ...base, webUIHealthTimeout: '0' })).toContain(
      '健康检查超时需为 ≥1 的整数（秒）',
    );
    expect(validateDraft({ ...base, webUIHealthUrl: '', webUIHealthTimeout: '' })).toEqual([]);
  });

  it('关闭可选区块后，其字段不再参与校验', () => {
    const base = { ...emptyDraft(), id: 'my-app', name: 'A', root: 'C:/Projects/a' };
    expect(
      validateDraft({
        ...base,
        portEnabled: false,
        portFrom: 'not-a-port',
        commandEnabled: false,
        commandId: '',
        webUIEnabled: false,
        webUIHealthUrl: 'bad',
      }),
    ).toEqual([]);
  });
});

describe('manifest-draft：parseArguments', () => {
  it('按空白与换行切分并丢弃空段', () => {
    expect(parseArguments('  -m  streamlit\n run ')).toEqual(['-m', 'streamlit', 'run']);
    expect(parseArguments('')).toEqual([]);
    expect(parseArguments('   \n  ')).toEqual([]);
  });
});

describe('manifest-draft：反解 draftFromManifest', () => {
  it('真实清单往返：受支持字段保持不变（webUI.url 属未覆盖区块，按设计丢弃）', () => {
    const rebuilt = buildManifest(draftFromManifest(REGISTRY_MANIFEST));
    expect(rebuilt).toEqual({
      schemaVersion: 'workbench.project/v1',
      project: {
        id: 'demo-service',
        name: '示例服务',
        description: 'Node http 静态服务；读 PORT 环境变量',
      },
      runtime: {
        root: 'C:/Projects/demo-service',
        port: { strategy: 'dynamic', from: 8120, to: 8129, environmentVariable: 'PORT' },
      },
      commands: [
        {
          id: 'start',
          type: 'service',
          executable: 'node',
          arguments: ['server.mjs'],
          concurrency: 'singleton',
        },
      ],
      webUI: {
        enabled: true,
        displayMode: 'proxy',
        startCommandId: 'start',
        healthCheck: { type: 'http', url: 'http://127.0.0.1:${port}/', timeoutSeconds: 20 },
      },
    });
  });

  it('job 类型 / parallel 并发 / external 显示模式可往返', () => {
    const draft = draftFromManifest({
      project: { id: 'a-b-c', name: 'A' },
      runtime: { root: 'C:/Projects/a' },
      commands: [
        {
          id: 'all',
          type: 'job',
          executable: 'python',
          arguments: ['main.py', 'all'],
          concurrency: 'parallel',
        },
      ],
      webUI: { enabled: true, displayMode: 'external' },
    });
    expect(draft.commandType).toBe('job');
    expect(draft.commandConcurrency).toBe('parallel');
    expect(draft.webUIDisplayMode).toBe('external');
    expect(draft.commandArguments).toBe('main.py all');
  });

  it('垃圾输入安全回落默认草稿（不抛异常）', () => {
    for (const bad of [null, undefined, 'x', 42, [], {}, { project: null }]) {
      const draft = draftFromManifest(bad);
      expect(draft.root).toBe('');
      expect(validateDraft(draft).length).toBeGreaterThan(0);
    }
  });

  it('端口存在但缺 environmentVariable 时不回填默认值（避免往返漂移）', () => {
    const draft = draftFromManifest({
      project: { id: 'a-b-c', name: 'A' },
      runtime: { root: 'C:/Projects/a', port: { strategy: 'dynamic', from: 8120, to: 8129 } },
    });
    expect(draft.portEnabled).toBe(true);
    expect(draft.portEnvVar).toBe('');
    expect(buildManifest(draft)).toMatchObject({
      runtime: { port: { strategy: 'dynamic', from: 8120, to: 8129 } },
    });
  });
});

describe('manifest-draft：detectUnmappedBlocks', () => {
  it('检出表单未覆盖的区块', () => {
    expect(
      detectUnmappedBlocks({
        models: { defaultProfileId: 'p1' },
        memory: { defaultScope: 'project' },
        commands: [{ id: 'a' }, { id: 'b' }],
        runtime: { root: 'C:/Projects/a', workingDirectory: 'x' },
        webUI: { enabled: true, url: 'http://x/', stopCommandId: 'stop' },
      }),
    ).toEqual([
      'models',
      'memory',
      '多命令（2 条）',
      'webUI.url',
      'webUI.stopCommandId',
      'runtime.workingDirectory',
    ]);
  });

  it('表单可完整覆盖的清单 → 无提示', () => {
    expect(
      detectUnmappedBlocks({
        schemaVersion: 'workbench.project/v1',
        project: { id: 'a-b-c', name: 'A' },
        runtime: { root: 'C:/Projects/a', port: { strategy: 'dynamic', from: 8120, to: 8129 } },
        commands: [{ id: 'start', type: 'service', executable: 'node', arguments: ['server.mjs'] }],
        webUI: {
          enabled: true,
          displayMode: 'proxy',
          startCommandId: 'start',
          healthCheck: { type: 'http', url: 'http://x/' },
        },
      }),
    ).toEqual([]);
  });

  it('真实清单因带 webUI.url（展示地址，表单不覆盖）而给出提示', () => {
    expect(detectUnmappedBlocks(REGISTRY_MANIFEST)).toEqual(['webUI.url']);
  });
});
