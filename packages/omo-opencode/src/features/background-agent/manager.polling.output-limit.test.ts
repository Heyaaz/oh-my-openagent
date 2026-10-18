/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"

type SessionMessage = {
  info: { role: string; finish?: string; tokens?: { output?: number; input?: number; reasoning?: number } }
  parts: Array<{ type: string; text?: string; reason?: string; tokens?: { output?: number } }>
}

const OUTPUT_LIMIT_ERROR = "stopped at output limit (32000 tokens), no result"

const LENGTH_TURN: SessionMessage = {
  info: { role: "assistant", finish: "length", tokens: { input: 1000, output: 32000, reasoning: 0 } },
  parts: [
    { type: "step-start" },
    { type: "step-finish", reason: "length", tokens: { output: 32000 } },
    { type: "patch" },
  ],
}

const EARLIER_WORK: SessionMessage[] = [
  { info: { role: "user" }, parts: [{ type: "text", text: "rewrite admin.el.md" }] },
  { info: { role: "assistant", finish: "stop", tokens: { output: 40 } }, parts: [{ type: "tool" }, { type: "text", text: "read the file" }] },
]

function createPluginContext(client: object): PluginInput {
  const directory = tmpdir()
  return {
    project: { id: "test-project", worktree: directory, time: { created: Date.now() } },
    directory,
    worktree: directory,
    serverUrl: new URL("http://localhost:4096"),
    $: {} as PluginInput["$"],
    client: client as PluginInput["client"],
  }
}

function createManager(state: { status: string; messages: SessionMessage[] }, sessionID: string): BackgroundManager {
  const client = {
    session: {
      status: async () => ({ data: { [sessionID]: { type: state.status } } }),
      get: async () => ({ data: { id: sessionID } }),
      prompt: async () => ({}),
      promptAsync: async () => ({}),
      abort: async () => ({}),
      todo: async () => ({ data: [] }),
      messages: async () => ({ data: state.messages }),
    },
  }
  return new BackgroundManager(
    { pluginContext: createPluginContext(client), config: undefined, enableParentSessionNotifications: false },
  )
}

function createRunningTask(sessionId: string): BackgroundTask {
  return {
    id: `bg_test_${sessionId}`,
    sessionId,
    parentSessionId: "parent-session",
    parentMessageId: "parent-msg",
    description: "Stage: admin.el.md",
    prompt: "test",
    agent: "sisyphus-junior",
    status: "running",
    startedAt: new Date(),
    progress: { toolCalls: 1, lastUpdate: new Date() },
  }
}

async function pollOnce(manager: BackgroundManager): Promise<void> {
  await manager["pollRunningTasks"]()
}

describe("BackgroundManager polling a session that stopped at the output token limit", () => {
  test("#given earlier output and a final assistant turn finished at the cap #when the session is idle #then the task is an error instead of a completion", async () => {
    // given
    const sessionID = "ses-length"
    const state = { status: "idle", messages: [...EARLIER_WORK, LENGTH_TURN] }
    const manager = createManager(state, sessionID)
    const task = createRunningTask(sessionID)
    manager["tasks"].set(task.id, task)
    manager.handleEvent({
      type: "message.part.updated",
      properties: { sessionID, type: "text", text: "read the file" },
    })

    // when
    await pollOnce(manager)
    await manager.shutdown()

    // then
    expect(task.status).toBe("error")
    expect(task.error).toBe(OUTPUT_LIMIT_ERROR)
  })

  test("#given the latest assistant turn finished normally after an earlier capped turn #when the session is idle #then the task completes", async () => {
    // given
    const sessionID = "ses-recovered-length"
    const state = {
      status: "idle",
      messages: [
        ...EARLIER_WORK,
        LENGTH_TURN,
        { info: { role: "assistant", finish: "stop", tokens: { output: 12 } }, parts: [{ type: "text", text: "wrote the file" }] },
      ],
    }
    const manager = createManager(state, sessionID)
    const task = createRunningTask(sessionID)
    manager["tasks"].set(task.id, task)

    // when
    await pollOnce(manager)
    await manager.shutdown()

    // then
    expect(task.status).toBe("completed")
    expect(task.error).toBeUndefined()
  })

  test("#given an idle session whose only turn was cut off with no text or tool part #when polled #then the task fails instead of staying running", async () => {
    // given
    const sessionID = "ses-length-empty"
    const state = { status: "idle", messages: [LENGTH_TURN] }
    const manager = createManager(state, sessionID)
    const task = createRunningTask(sessionID)
    manager["tasks"].set(task.id, task)

    // when
    await pollOnce(manager)
    await manager.shutdown()

    // then
    expect(task.status).toBe("error")
    expect(task.error).toBe(OUTPUT_LIMIT_ERROR)
  })
})
