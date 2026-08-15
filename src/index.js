/**
 * @one/dsh-moat — 代码质量门禁插件
 *
 * 在提交前自动检查代码质量：语法检查、启动链验证、API 测试、跨系统关联检测。
 * 基于 moat-ai（PyPI 包）和自定义检查规则。
 */
import { execFile, execSync } from 'node:child_process'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { join } from 'node:path'

export const name = '@wang-jie-git/dsh-moat'
export const inject = ['tools']

const TIMEOUT_MS = 120000
const MAX_OUTPUT = 512 * 1024

function resolveConfig(config = {}) {
  const env = process.env
  const projectRoot = config.projectRoot ?? env.MOAT_PROJECT_ROOT ?? process.cwd()
  const pythonPath = config.pythonPath ?? env.MOAT_PYTHON ?? 'python3'
  return { projectRoot: String(projectRoot), pythonPath: String(pythonPath) }
}

function runMoat(pythonPath, args, cwd) {
  return new Promise((resolve) => {
    execFile(pythonPath, ['-m', 'moat', ...args], { cwd, timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT, windowsHide: true },
      (err, stdout, stderr) => {
        const output = stdout || stderr || err?.message || ''
        resolve({ ok: true, output: output.slice(0, MAX_OUTPUT), error: '' })
      }
    )
  })
}

function checkMoatInstalled(pythonPath) {
  try { execSync(`${pythonPath} -c "import moat; print(moat.__version__)"`, { timeout: 5000 }); return true }
  catch { return false }
}

function installMoat(pythonPath) {
  return new Promise((resolve) => {
    execFile(pythonPath, ['-m', 'pip', 'install', 'moat-ai'], { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, output: '', error: `安装 moat-ai 失败: ${stderr?.slice(0, 500) || err.message}` })
      else resolve({ ok: true, output: 'moat-ai 安装成功', error: '' })
    })
  })
}

const renderText = (_args, value) => [{ type: 'text', text: value.output || value.error || '' }]

export function apply(ctx, config = {}) {
  const cfg = resolveConfig(config)
  let moatReady = false

  ctx.on('ready', async () => {
    moatReady = checkMoatInstalled(cfg.pythonPath)
    if (!moatReady) ctx.logger.warn('[moat] moat-ai 未安装，请运行 moat_install 命令安装')
  })

  ctx.tools.register(defineTool({
    name: 'moat_check',
    description: '运行完整代码质量门禁检查。包括语法检查、启动链验证、API 测试和跨系统关联检测。',
    parameters: {
      path: { type: 'string', description: '要检查的路径，默认项目根目录' },
      skipL4: { type: 'boolean', description: '是否跳过第 4 层（跨系统关联）检查，默认 false' }
    },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, output: { type: 'string' }, error: { type: 'string' } }, additionalProperties: true }, render: renderText },
    async execute({ path, skipL4 = false }) {
      if (!moatReady) return { ok: false, output: '', error: 'moat-ai 未安装。请先运行 moat_install 命令安装。' }
      const args = ['check', '--path', path || cfg.projectRoot]
      if (skipL4) args.push('--skip-l4')
      return runMoat(cfg.pythonPath, args, cfg.projectRoot)
    }
  }))

  ctx.tools.register(defineTool({
    name: 'moat_syntax',
    description: '仅运行语法检查（快速，不启动服务）。检查 Python 语法错误和 import 路径。',
    parameters: {
      path: { type: 'string', required: true, description: '要检查的文件或目录路径' }
    },
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, output: { type: 'string' }, error: { type: 'string' } }, additionalProperties: true }, render: renderText },
    async execute({ path }) {
      if (!moatReady) return { ok: false, output: '', error: 'moat-ai 未安装。请先运行 moat_install 命令安装。' }
      return runMoat(cfg.pythonPath, ['syntax', '--path', path], cfg.projectRoot)
    }
  }))

  ctx.tools.register(defineTool({
    name: 'moat_install',
    description: '安装 moat-ai 代码质量门禁工具（pip install moat-ai）。需要联网。',
    parameters: {},
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, output: { type: 'string' }, error: { type: 'string' } }, additionalProperties: true }, render: renderText },
    async execute() {
      const result = await installMoat(cfg.pythonPath)
      if (result.ok) moatReady = true
      return result
    }
  }))

  ctx.tools.register(defineTool({
    name: 'moat_status',
    description: '查看 moat 门禁配置状态，包括是否已安装、项目根目录、Python 路径等。',
    parameters: {},
    output: { schema: { type: 'object', properties: { ok: { type: 'boolean' }, output: { type: 'string' }, error: { type: 'string' } }, additionalProperties: true }, render: renderText },
    async execute() {
      const installed = checkMoatInstalled(cfg.pythonPath)
      let version = '未知'
      if (installed) {
        try { version = execSync(`${cfg.pythonPath} -c "import moat; print(moat.__version__)"`, { timeout: 3000 }).toString().trim() }
        catch { /* ignore */ }
      }
      return {
        ok: true,
        output: [
          `📋 moat 门禁状态`,
          `  ├─ moat-ai: ${installed ? '✅ 已安装' : '❌ 未安装'}`,
          `  ├─ 版本: ${version}`,
          `  ├─ 项目根目录: ${cfg.projectRoot}`,
          `  └─ Python: ${cfg.pythonPath}`,
          '', installed ? '运行 moat_check 开始检查' : '运行 moat_install 安装 moat-ai'
        ].join('\n')
      }
    }
  }))
}