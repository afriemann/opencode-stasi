import { Plugin } from "@opencode/plugin"
import { dirname, join, sep } from "node:path"
import { defaultConfigPath, defaultDbPath, loadConfig } from "./config-file.ts"
import { createLogger } from "./logger.ts"
import { createGit } from "./git/git.ts"
import { createCaptureHook } from "./host/capture.ts"
import { createChildProbe } from "./host/child-probe.ts"
import { createLineageCheck } from "./host/lineage.ts"
import { createPassHost } from "./host/pass-host.ts"
import { createParentCapture } from "./host/parent-capture.ts"
import { parentRatingsTool, rateParentTool } from "./host/parent-tools.ts"
import { asHostPort } from "./host/port.ts"
import { createReminder } from "./host/reminder.ts"
import { subagentTuningResolveTool } from "./host/resolve.ts"
import { correctSubagentRatingTool, rateSubagentTool, registerTools, subagentRatingsTool } from "./host/tools.ts"
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

    // Every pass worktree is its own location and gets its own plugin instance. Only instances outside
    // the worktree root may start passes; otherwise each pass would spawn the next one.
    const worktreeRoot = join(dirname(dbPath), "worktrees")
    const passive = ctx.location.directory === worktreeRoot || ctx.location.directory.startsWith(`${worktreeRoot}${sep}`)
    if (passive) info(`pass worktree location ${ctx.location.directory}: passive, will not start passes`)
    else store.reconcileStalePasses(now(), config.pass.timeoutMinutes * MINUTE_MS)

    const runner = createPassRunner({
      store,
      config,
      ports: passHost,
      worktreeRoot,
      now,
      log,
      builtinTunerEnabled: config.pass.agent === undefined,
      info,
    })
    const startPasses = () => {
      if (!passive) void runner.drain().catch((error: unknown) => log("improvement pass failed", error))
    }

    const probe = createChildProbe(port)
    const parentCapture = createParentCapture({ port, store, config, now, passSessionIds: () => passHost.passSessionIds, passive, log })
    const parentDeps = { store, config, capture: parentCapture, now, log }
    const toolDeps = { store, config, now, probe, onTripped: startPasses, info }
    await registerTools(port, [
      rateParentTool(parentDeps),
      parentRatingsTool(parentDeps),
      rateSubagentTool(toolDeps),
      correctSubagentRatingTool({ store, config, now }),
      subagentRatingsTool(toolDeps),
      subagentTuningResolveTool({ store, config, git, now, isRootOutsidePass }),
    ])
    await ctx.tool.hook("execute.after", createCaptureHook({ port, store, config, inPassLineage, now, log, info }) as never)
    await port.tool.hook("execute.before", parentCapture.before)
    await port.session.hook("prompt", parentCapture.prompt)

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
    info(`ready: tools rate_parent, parent_ratings, rate_subagent, correct_subagent_rating, subagent_ratings, subagent_tuning_resolve registered; tuner ${config.pass.agent ?? BUILTIN_TUNER_ID}`)

    return () => {
      info("unloading")
      stop.abort()
      probe.dispose()
      parentCapture.dispose()
      store.close()
    }
  },
})
