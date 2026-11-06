import {
  buildManifest,
  validateDraft,
  type ManifestCommandType,
  type ManifestConcurrency,
  type ManifestDisplayMode,
  type ManifestDraft,
} from './manifest-draft';
import { Alert, Field, Input, Select } from './ui';

export interface ProjectManifestFormProps {
  draft: ManifestDraft;
  onChange: (next: ManifestDraft) => void;
  disabled?: boolean;
}

/**
 * 登记表单（S1 实用档）：必填 4 项 + 端口段 / 单个启动命令 / Web UI（可勾选启用）。
 * 受控组件：只回传草稿，提交仍由父级走既有 register 端点。
 */
export default function ProjectManifestForm({
  draft,
  onChange,
  disabled,
}: ProjectManifestFormProps) {
  function set<K extends keyof ManifestDraft>(key: K, value: ManifestDraft[K]) {
    onChange({ ...draft, [key]: value });
  }

  const errors = validateDraft(draft);
  const preview = JSON.stringify(buildManifest(draft), null, 2);

  return (
    <div className="wb-col">
      <p className="wb-field__label" style={{ margin: 0 }}>
        必填
      </p>

      <Field label="项目 ID">
        <Input
          id="wb-reg-id"
          aria-label="项目 ID"
          value={draft.id}
          disabled={disabled}
          spellCheck={false}
          placeholder="my-app"
          onChange={(e) => set('id', e.target.value)}
        />
      </Field>

      <Field label="项目名称">
        <Input
          id="wb-reg-name"
          aria-label="项目名称"
          value={draft.name}
          disabled={disabled}
          placeholder="我的应用"
          onChange={(e) => set('name', e.target.value)}
        />
      </Field>

      <Field label="项目根目录" hint="必须是绝对路径；运行期按此解析。">
        <Input
          id="wb-reg-root"
          aria-label="项目根目录"
          value={draft.root}
          disabled={disabled}
          spellCheck={false}
          placeholder="C:/Projects/my-app"
          onChange={(e) => set('root', e.target.value)}
        />
      </Field>

      <Field label="项目描述" hint="可选。">
        <Input
          id="wb-reg-desc"
          aria-label="项目描述"
          value={draft.description}
          disabled={disabled}
          onChange={(e) => set('description', e.target.value)}
        />
      </Field>

      <p className="wb-field__label" style={{ margin: 0 }}>
        可选 · 勾选后写入 manifest
      </p>

      <div className="wb-group">
        <label className="wb-check" htmlFor="wb-reg-port-enabled">
          <input
            id="wb-reg-port-enabled"
            aria-label="启用端口段"
            type="checkbox"
            checked={draft.portEnabled}
            disabled={disabled}
            onChange={(e) => set('portEnabled', e.target.checked)}
          />
          <span>端口段</span>
        </label>
        {draft.portEnabled ? (
          <div className="wb-row" style={{ gap: 6, alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Field label="起点">
                <Input
                  id="wb-reg-port-from"
                  aria-label="端口段起点"
                  value={draft.portFrom}
                  disabled={disabled}
                  onChange={(e) => set('portFrom', e.target.value)}
                />
              </Field>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Field label="终点">
                <Input
                  id="wb-reg-port-to"
                  aria-label="端口段终点"
                  value={draft.portTo}
                  disabled={disabled}
                  onChange={(e) => set('portTo', e.target.value)}
                />
              </Field>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Field label="环境变量">
                <Input
                  id="wb-reg-port-env"
                  aria-label="端口环境变量"
                  value={draft.portEnvVar}
                  disabled={disabled}
                  spellCheck={false}
                  onChange={(e) => set('portEnvVar', e.target.value)}
                />
              </Field>
            </div>
          </div>
        ) : null}
        <p className="wb-field__hint" style={{ margin: '6px 0 0' }}>
          端口只经环境变量注入，不要写进命令参数。
        </p>
      </div>

      <div className="wb-group">
        <label className="wb-check" htmlFor="wb-reg-cmd-enabled">
          <input
            id="wb-reg-cmd-enabled"
            aria-label="启用启动命令"
            type="checkbox"
            checked={draft.commandEnabled}
            disabled={disabled}
            onChange={(e) => set('commandEnabled', e.target.checked)}
          />
          <span>启动命令</span>
        </label>
        {draft.commandEnabled ? (
          <div className="wb-col" style={{ gap: 'var(--wb-space-2)' }}>
            <div className="wb-row" style={{ gap: 6, alignItems: 'flex-end' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Field label="命令 ID">
                  <Input
                    id="wb-reg-cmd-id"
                    aria-label="命令 ID"
                    value={draft.commandId}
                    disabled={disabled}
                    spellCheck={false}
                    onChange={(e) => set('commandId', e.target.value)}
                  />
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Field label="类型">
                  <Select
                    id="wb-reg-cmd-type"
                    aria-label="命令类型"
                    value={draft.commandType}
                    disabled={disabled}
                    onChange={(e) => set('commandType', e.target.value as ManifestCommandType)}
                  >
                    <option value="service">service（常驻）</option>
                    <option value="job">job（一次性）</option>
                  </Select>
                </Field>
              </div>
            </div>
            <Field label="可执行文件">
              <Input
                id="wb-reg-cmd-exe"
                aria-label="可执行文件"
                value={draft.commandExecutable}
                disabled={disabled}
                spellCheck={false}
                onChange={(e) => set('commandExecutable', e.target.value)}
              />
            </Field>
            <Field label="参数（空白分隔）">
              <Input
                id="wb-reg-cmd-args"
                aria-label="命令参数"
                value={draft.commandArguments}
                disabled={disabled}
                spellCheck={false}
                onChange={(e) => set('commandArguments', e.target.value)}
              />
            </Field>
            <Field label="并发">
              <Select
                id="wb-reg-cmd-concurrency"
                aria-label="命令并发"
                value={draft.commandConcurrency}
                disabled={disabled}
                onChange={(e) => set('commandConcurrency', e.target.value as ManifestConcurrency)}
              >
                <option value="singleton">singleton（单例）</option>
                <option value="parallel">parallel（并行）</option>
              </Select>
            </Field>
          </div>
        ) : (
          <p className="wb-field__hint" style={{ margin: '6px 0 0' }}>
            未勾选：项目登记后没有可执行命令，将无法启动 / 进入 Web UI。
          </p>
        )}
      </div>

      <div className="wb-group">
        <label className="wb-check" htmlFor="wb-reg-webui-enabled">
          <input
            id="wb-reg-webui-enabled"
            aria-label="启用 Web UI"
            type="checkbox"
            checked={draft.webUIEnabled}
            disabled={disabled}
            onChange={(e) => set('webUIEnabled', e.target.checked)}
          />
          <span>Web UI 健康检查</span>
        </label>
        {draft.webUIEnabled ? (
          <div className="wb-col" style={{ gap: 'var(--wb-space-2)' }}>
            <Field label="显示模式">
              <Select
                id="wb-reg-display-mode"
                aria-label="显示模式"
                value={draft.webUIDisplayMode}
                disabled={disabled}
                onChange={(e) => set('webUIDisplayMode', e.target.value as ManifestDisplayMode)}
              >
                <option value="proxy">proxy（同源代理）</option>
                <option value="external">external（外部跳转）</option>
                <option value="embedded">embedded（内嵌）</option>
              </Select>
            </Field>
            <Field label="健康检查 URL">
              <Input
                id="wb-reg-health-url"
                aria-label="健康检查 URL"
                value={draft.webUIHealthUrl}
                disabled={disabled}
                spellCheck={false}
                onChange={(e) => set('webUIHealthUrl', e.target.value)}
              />
            </Field>
            <Field label="超时（秒）">
              <Input
                id="wb-reg-health-timeout"
                aria-label="健康检查超时"
                value={draft.webUIHealthTimeout}
                disabled={disabled}
                onChange={(e) => set('webUIHealthTimeout', e.target.value)}
              />
            </Field>
          </div>
        ) : null}
      </div>

      {errors.length > 0 ? (
        <Alert tone="warn" label="表单校验问题">
          {errors.map((message) => (
            <div key={message}>· {message}</div>
          ))}
        </Alert>
      ) : null}

      <p className="wb-field__label" style={{ margin: 0 }}>
        提交内容预览
      </p>
      <pre aria-label="manifest 预览" className="wb-code" style={{ maxHeight: 220, fontSize: 11 }}>
        {preview}
      </pre>
      <p className="wb-field__hint" style={{ margin: 0 }}>
        未勾选的区块不会写入 —— 服务端 Schema 为 additionalProperties: false。
      </p>
    </div>
  );
}
