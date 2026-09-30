import { Plugin } from "@opencode/plugin"
import { dirname, join } from "node:path"
import { defaultConfigPath, defaultDbPath, loadConfig } from "./config-file.ts"
import { createLogger } from "./logger.ts"
import { createGit } from "./git/git.ts"
import { createCaptureHook } from "./host/capture.ts"
import { createLineageCheck } from "./host/lineage.ts"
import { createPassHost } from "./host/pass-host.ts"
import { asHostPort } from "./host/port.ts"
import { createReminder } from "./host/reminder.ts"
import { subagentTuningResolveTool } from "./host/resolve.ts"
import { rateSubagentTool, registerTools, subagentRatingsTool } from "./host/tools.ts"
import { createContainment, type ContextEvent, type PermissionEvent } from "./pass/containment.ts"
import { BUILTIN_TUNER_ID, createPassRunner } from "./pass/runner.ts"
import { registerBuiltinTuner } from "./pass/tuner.ts"
import { openStore } from "./store/repo.ts"

const PLUGIN_ID = "opencode-stasi"
const MINUTE_MS = 60_000

export default Plugin.define({
  id: PLUGIN_ID,
  async setup(ctx) {
    const logger = createLogger()
    const log = logger.error
    const info = logger.info
    info("loading")
    const options = (ctx.options ?? {}) as { configPath?: unknown }
    const configPath = typeof options.configPath === "string" ? options.configPath : defaultConfigPath()
    const loaded = await loadConfig(configPath)
    if (!loaded.ok) return void log(`disabled: ${loaded.error}`)
    const config = loaded.config
    info(`configuration loaded from ${configPath} (missing file means defaults); threshold ${config.threshold}, window ${config.windowSize}, minSamples ${config.minSamples}, samplingRate ${config.samplingRate}`)
    info(config.agentConfigRepo === undefined ? "agentConfigRepo unset: tripped agents stay notify-only" : "agentConfigRepo set: improvement passes enabled")

    const dbPath = config.dbPath ?? defaultDbPath()
    const store = await openStore(dbPath).catch((error: unknown) => void log("disabled: cannot open the ratings database", error))
    if (!store) return
    info(`ratings database open at ${dbPath}`)

    const now = () => Date.now()
    const port = asHostPort(ctx)
    const git = createGit()
    const passHost = createPassHost(ctx, git, log)
    const inPassLineage = createLineageCheck(port, () => passHost.passSessionIds, (error) => log("lineage check failed", error))

    const rootCache = new Map<string, boolean>()
    const isRootOutsidePass = async (sessionId: string): Promise<boolean> => {
      const cached = rootCache.get(sessionId)
      if (cached !== undefined) return cached
      const isRoot = await port.session.get({ sessionID: sessionId as never }).then(
        (info) => info.parentID === undefined,
        () => false,
      )
      const result = isRoot && !(await inPassLineage(sessionId))
      rootCache.set(sessionId, result)
      return result
    }

    store.reconcileStalePasses(now(), config.pass.timeoutMinutes * MINUTE_MS)

    const runner = createPassRunner({
      store,
      config,
      ports: passHost,
      worktreeRoot: join(dirname(dbPath), "worktrees"),
      now,
      log,
      builtinTunerEnabled: config.pass.agent === undefined,
      info,
    })
    const startPasses = () => void runner.drain().catch((error: unknown) => log("improvement pass failed", error))

    const toolDeps = { store, config, now, onTripped: startPasses, info }
    await registerTools(port, [
      rateSubagentTool(toolDeps),
      subagentRatingsTool(toolDeps),
      subagentTuningResolveTool({ store, config, git, now, isRootOutsidePass }),
    ])
    await ctx.tool.hook("execute.after", createCaptureHook({ port, store, config, inPassLineage, now, log, info }) as never)

    if (config.pass.agent === undefined) await registerBuiltinTuner(ctx.agent, BUILTIN_TUNER_ID, config.pass.tools)

    const containment = createContainment({ inPassLineage, allowedTools: config.pass.tools })
    const remind = createReminder({
      store,
      now,
      isRootOutsidePass,
      log,
      notify: (sessionID, text) => ctx.session.synthetic({ sessionID: sessionID as never, text, resume: false }).then(() => undefined),
    })
    await ctx.session.hook("context", async (event) => {
      await containment.onContext(event as unknown as ContextEvent).catch((error: unknown) => log("containment failed", error))
      void remind(event.sessionID)
    })
    await ctx.permission.hook("evaluate", (event) =>
      containment.onPermission(event as unknown as PermissionEvent).catch((error: unknown) => log("containment failed", error)),
    )

    const stop = new AbortController()
    void passHost.watchEvents(stop.signal)
    startPasses()
    info(`ready: tools rate_subagent, subagent_ratings, subagent_tuning_resolve registered; tuner ${config.pass.agent ?? BUILTIN_TUNER_ID}`)

    return () => {
      info("unloading")
      stop.abort()
      store.close()
    }
  },
})
