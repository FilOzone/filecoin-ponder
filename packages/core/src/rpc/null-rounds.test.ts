import { BlockNotFoundError, type Hex, hexToNumber, numberToHex } from "viem";
import { beforeEach, expect, test, vi } from "vitest";
import { context, setupCommon } from "@/_test/setup.js";
import { getChain } from "@/_test/utils.js";
import type { Chain } from "@/internal/types.js";
import { getFinalizedBlock } from "@/utils/finality.js";
import { eth_getBlockAtOrBelow, isNullRoundError } from "./actions.js";
import { createRpc, type Rpc } from "./index.js";

beforeEach(setupCommon);

test("isNullRoundError returns true for RPC error code 12", () => {
  const error = Object.assign(new Error("request failed"), {
    cause: { code: 12, message: "requested epoch was a null round" },
  });
  expect(isNullRoundError(error)).toBe(true);
});

test("isNullRoundError returns true for 'null round' message", () => {
  const error = new Error("requested epoch was a null round");
  expect(isNullRoundError(error)).toBe(true);
});

test("isNullRoundError returns false for BlockNotFoundError", () => {
  const error = new BlockNotFoundError({ blockNumber: 100n });
  expect(isNullRoundError(error)).toBe(false);
});

test("isNullRoundError returns false for unrelated errors", () => {
  expect(isNullRoundError(new Error("timeout"))).toBe(false);
  expect(isNullRoundError(null)).toBe(false);
  expect(isNullRoundError(undefined)).toBe(false);
});

test("isNullRoundError returns false for non-12 RPC error codes", () => {
  const error = Object.assign(new Error("request failed"), {
    cause: { code: -32000, message: "server error" },
  });
  expect(isNullRoundError(error)).toBe(false);
});

/** Serves blocks at `heights` and answers every other height as a Filecoin null round. */
function rpcWithBlocksAt(heights: number[], requested: number[] = []): Rpc {
  return {
    request: async ({ params }: { params: [Hex, boolean] }) => {
      const number = hexToNumber(params[0]);
      requested.push(number);
      if (!heights.includes(number)) {
        throw Object.assign(new Error("requested epoch was a null round"), {
          cause: { code: 12 },
        });
      }
      return {
        number: params[0],
        hash: numberToHex(number, { size: 32 }),
        parentHash: numberToHex(Math.max(number - 1, 0), { size: 32 }),
        timestamp: numberToHex(number * 30),
        logsBloom: `0x${"f".repeat(512)}`,
      };
    },
  } as unknown as Rpc;
}

test("eth_getBlockAtOrBelow returns the block at the requested height", async () => {
  const block = await eth_getBlockAtOrBelow(rpcWithBlocksAt([10]), 10);
  expect(hexToNumber(block.number)).toBe(10);
});

test("eth_getBlockAtOrBelow steps down past null rounds", async () => {
  const requested: number[] = [];
  const block = await eth_getBlockAtOrBelow(
    rpcWithBlocksAt([7, 10], requested),
    9,
  );
  expect(hexToNumber(block.number)).toBe(7);
  expect(requested).toEqual([9, 8, 7]);
});

test("eth_getBlockAtOrBelow rethrows errors other than null rounds", async () => {
  const rpc = {
    request: async () => {
      throw new Error("connection refused");
    },
  } as unknown as Rpc;
  await expect(eth_getBlockAtOrBelow(rpc, 9)).rejects.toThrow(
    "connection refused",
  );
});

test("eth_getBlockAtOrBelow gives up after a long run of null rounds", async () => {
  const requested: number[] = [];
  await expect(
    eth_getBlockAtOrBelow(rpcWithBlocksAt([], requested), 5_000),
  ).rejects.toThrow("null round");
  expect(requested).toHaveLength(1_001);
});

test("getFinalizedBlock takes the nearest block below a null-round target", async () => {
  // 30-second blocks and a 600-second window put the target at height 80.
  const heights = Array.from({ length: 101 }, (_, i) => i).filter(
    (h) => h !== 79 && h !== 80,
  );
  const rpc = rpcWithBlocksAt(heights);
  const latestBlock = await eth_getBlockAtOrBelow(rpc, 100);

  const block = await getFinalizedBlock({
    chain: { reorgWindow: 600 } as Chain,
    rpc,
    latestBlock,
  });

  expect(hexToNumber(block.number)).toBe(78);
});

test.each([
  { code: 12, message: "requested epoch was a null round" },
  {
    code: 1,
    message: "bad tipset height: lookbacks of more than 24h0m0s are disallowed",
  },
])("createRpc() does not retry $message", async (error) => {
  const rpc = createRpc({ common: context.common, chain: getChain() });

  // Every response is the error, so any retry would show as a second call.
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(
      async () =>
        new Response(JSON.stringify({ jsonrpc: "2.0", error, id: 1 })),
    );
  // Under Bun, calls from spies in earlier tests carry over.
  fetchSpy.mockClear();

  try {
    await expect(
      rpc.request({ method: "eth_getBlockByNumber", params: ["0x100", true] }),
    ).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  } finally {
    fetchSpy.mockRestore();
  }
});
