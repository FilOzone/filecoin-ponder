import { BlockNotFoundError, type Hex, hexToNumber, numberToHex } from "viem";
import { expect, test } from "vitest";
import {
  eth_getBlockAtOrBelow,
  isBlockNotFoundError,
  isNullRoundError,
} from "./actions.js";
import type { Rpc } from "./index.js";

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

test("isBlockNotFoundError returns true for BlockNotFoundError", () => {
  const error = new BlockNotFoundError({ blockNumber: 100n });
  expect(isBlockNotFoundError(error)).toBe(true);
});

test("isBlockNotFoundError returns true for wrapped BlockNotFoundError", () => {
  const cause = new BlockNotFoundError({ blockNumber: 100n });
  const error = Object.assign(new Error("wrapper"), { cause });
  expect(isBlockNotFoundError(error)).toBe(true);
});

test("isBlockNotFoundError returns true for null round (code 12)", () => {
  const error = Object.assign(new Error("request failed"), {
    cause: { code: 12, message: "requested epoch was a null round" },
  });
  expect(isBlockNotFoundError(error)).toBe(true);
});

test("isBlockNotFoundError returns false for unrelated errors", () => {
  expect(isBlockNotFoundError(new Error("timeout"))).toBe(false);
  expect(isBlockNotFoundError(null)).toBe(false);
  expect(isBlockNotFoundError(undefined)).toBe(false);
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
        parentHash: numberToHex(number - 1, { size: 32 }),
        timestamp: "0x0",
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
