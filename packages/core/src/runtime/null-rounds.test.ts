import { numberToHex } from "viem";
import { beforeEach, expect, test } from "vitest";
import { context, setupCommon } from "@/_test/setup.js";
import { getBlocksIndexingBuild, getChain } from "@/_test/utils.js";
import type { LightBlock } from "@/internal/types.js";
import type { Rpc } from "@/rpc/index.js";
import { getFragments } from "./fragments.js";
import { type CachedIntervals, getLocalSyncProgress } from "./index.js";

beforeEach(setupCommon);

// The RPC answers the start block as a Lotus null round.
const rpc = {
  request: async () => {
    throw Object.assign(new Error("requested epoch was a null round"), {
      cause: { code: 12 },
    });
  },
} as unknown as Rpc;

const finalizedBlock = {
  hash: `0x${"1".repeat(64)}`,
  parentHash: `0x${"2".repeat(64)}`,
  number: numberToHex(100),
  timestamp: numberToHex(1_700_003_000),
} satisfies LightBlock;

function syncProgress(chainId: number) {
  const { eventCallbacks } = getBlocksIndexingBuild({ interval: 1 });
  const cachedIntervals: CachedIntervals = new Map();
  for (const { filter } of eventCallbacks) {
    cachedIntervals.set(
      filter,
      getFragments(filter).map(({ fragment }) => ({ fragment, intervals: [] })),
    );
  }
  return getLocalSyncProgress({
    common: context.common,
    filters: eventCallbacks.map(({ filter }) => filter),
    chain: { ...getChain(), id: chainId },
    rpc,
    finalizedBlock,
    cachedIntervals,
  });
}

test("a Filecoin start block that is a null round gets a placeholder", async () => {
  const { start } = await syncProgress(314);

  // Block 0, 100 epochs of 30 seconds before the finalized block.
  expect(start).toMatchObject({
    number: "0x0",
    timestamp: numberToHex(1_700_000_000),
  });
});

test("a start block that can't be fetched fails on other chains", async () => {
  await expect(syncProgress(1)).rejects.toThrow("null round");
});
