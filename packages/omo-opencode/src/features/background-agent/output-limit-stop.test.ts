/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { getOutputLimitStop } from "./output-limit-stop"

const LENGTH_TURN = {
  info: {
    role: "assistant",
    finish: "length",
    tokens: { input: 1000, output: 32000, reasoning: 0 },
  },
  parts: [
    { type: "step-start" },
    { type: "step-finish", reason: "length", tokens: { output: 32000 } },
    { type: "patch" },
  ],
}

describe("getOutputLimitStop", () => {
  test("#given the latest assistant turn finished at the output cap with no text or tool part #when read #then it reports the token count and no result", () => {
    // given
    const messages = [
      { info: { role: "user" }, parts: [{ type: "text", text: "rewrite the file" }] },
      { info: { role: "assistant", finish: "stop" }, parts: [{ type: "tool" }, { type: "text", text: "read the file" }] },
      LENGTH_TURN,
    ]

    // when
    const result = getOutputLimitStop(messages)

    // then
    expect(result).toBe("stopped at output limit (32000 tokens), no result")
  })

  test("#given finish is absent and the last step-finish reason is length #when read #then it still reports the stop", () => {
    // given
    const messages = [{
      info: { role: "assistant", tokens: { output: 32000 } },
      parts: [{ type: "step-finish", reason: "length" }],
    }]

    // when
    const result = getOutputLimitStop(messages)

    // then
    expect(result).toBe("stopped at output limit (32000 tokens), no result")
  })

  test("#given the capped turn still delivered text #when read #then the stop omits the no-result clause", () => {
    // given
    const messages = [{
      info: { role: "assistant", finish: "length" },
      parts: [{ type: "text", text: "partial summary" }],
    }]

    // when
    const result = getOutputLimitStop(messages)

    // then
    expect(result).toBe("stopped at output limit")
  })

  test("#given a later assistant turn finished normally #when read #then an earlier length stop is ignored", () => {
    // given
    const messages = [
      LENGTH_TURN,
      { info: { role: "assistant", finish: "stop" }, parts: [{ type: "text", text: "done" }] },
    ]

    // when
    const result = getOutputLimitStop(messages)

    // then
    expect(result).toBeUndefined()
  })

  test("#given the latest message is not an assistant turn #when read #then the session is not stopped", () => {
    // given
    const messages = [LENGTH_TURN, { info: { role: "user" }, parts: [{ type: "text", text: "continue" }] }]

    // when
    const result = getOutputLimitStop(messages)

    // then
    expect(result).toBeUndefined()
  })

  test("#given the message finish is stop even if a step says length #when read #then the session is not stopped", () => {
    // given
    const messages = [{
      info: { role: "assistant", finish: "stop", tokens: { output: 20 } },
      parts: [{ type: "step-finish", reason: "length" }, { type: "text", text: "done" }],
    }]

    // when
    const result = getOutputLimitStop(messages)

    // then
    expect(result).toBeUndefined()
  })
})
