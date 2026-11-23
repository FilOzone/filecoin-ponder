import { hexToNumber } from "viem";
import { parseEther } from "viem/utils";
import { beforeEach, expect, test } from "vitest";
import { ALICE } from "@/_test/constants.js";
import {
  context,
  setupAnvil,
  setupCachedIntervals,
  setupChildAddresses,
  setupCleanup,
  setupCommon,
  setupDatabaseServices,
  setupIsolatedDatabase,
} from "@/_test/setup.js";
import { deployErc20, mintErc20, simulateBlock } from "@/_test/simulate.js";
import {
  getBlocksIndexingBuild,
  getChain,
  getErc20IndexingBuild,
} from "@/_test/utils.js";
import type { EventCallback } from "@/internal/types.js";
import { createRpc, type Rpc } from "@/rpc/index.js";
import { getRequiredIntervalsWithFilters } from "@/runtime/index.js";
import * as ponderSyncSchema from "@/sync-store/schema.js";
import { drainAsyncGenerator } from "@/utils/generators.js";
import { createInMemoryHistoricalSync } from "./in-memory.js";
import { createHistoricalSync } from "./index.js";

// Historical sync over a height that the RPC answers as a null round, as Lotus
// does for a Filecoin epoch without a block. Anvil has a block at every height,
// so the RPC is wrapped to answer one height that way.

beforeEach(setupCommon);
beforeEach(setupAnvil);
beforeEach(setupIsolatedDatabase);
beforeEach(setupCleanup);

function withNullRound(rpc: Rpc, height: number): Rpc {
  return {
    ...rpc,
    request: (params, context) => {
      if (
        params.method === "eth_getBlockByNumber" &&
        hexToNumber(params.params[0] as `0x${string}`) === height
      ) {
        return Promise.reject(
          Object.assign(new Error("requested epoch was a null round"), {
            cause: { code: 12 },
          }),
        );
      }
      return rpc.request(params, context);
    },
  };
}

async function syncCached(
  eventCallbacks: EventCallback[],
  rpc: Rpc,
  interval: [number, number],
) {
  const { syncStore, database } = await setupDatabaseServices();
  const historicalSync = createHistoricalSync({
    common: context.common,
    chain: getChain(),
    rpc,
    childAddresses: setupChildAddresses(eventCallbacks),
  });
  const requiredIntervals = getRequiredIntervalsWithFilters({
    interval,
    filters: eventCallbacks.map(({ filter }) => filter),
    cachedIntervals: setupCachedIntervals(eventCallbacks),
  });
  const logs = await historicalSync.syncBlockRangeData({
    interval,
    requiredIntervals: requiredIntervals.intervals,
    requiredFactoryIntervals: requiredIntervals.factoryIntervals,
    syncStore,
  });
  await historicalSync.syncBlockData({
    interval,
    requiredIntervals: requiredIntervals.intervals,
    logs,
    syncStore,
  });
  return database.syncQB.wrap((db) =>
    db.select().from(ponderSyncSchema.blocks).execute(),
  );
}

function syncInMemory(
  eventCallbacks: EventCallback[],
  rpc: Rpc,
  interval: [number, number],
) {
  const historicalSync = createInMemoryHistoricalSync({
    common: context.common,
    chain: getChain(),
    rpc,
    childAddress: setupChildAddresses(eventCallbacks),
  });
  const requiredIntervals = getRequiredIntervalsWithFilters({
    interval,
    filters: eventCallbacks.map(({ filter }) => filter),
    cachedIntervals: setupCachedIntervals(eventCallbacks),
  });
  return drainAsyncGenerator(
    historicalSync.syncBlockData({
      requiredIntervals: requiredIntervals.intervals,
      requiredFactoryIntervals: requiredIntervals.factoryIntervals,
    }),
  );
}

const rpc = () => createRpc({ chain: getChain(), common: context.common });

async function erc20WithMintAtBlock2() {
  const { address } = await deployErc20({ sender: ALICE });
  await mintErc20({
    erc20: address,
    to: ALICE,
    amount: parseEther("1"),
    sender: ALICE,
  });
  return getErc20IndexingBuild({ address }).eventCallbacks;
}

test("cached sync skips a null round", async () => {
  const { eventCallbacks } = getBlocksIndexingBuild({ interval: 1 });
  for (let i = 0; i < 3; i++) await simulateBlock();

  const blocks = await syncCached(
    eventCallbacks,
    withNullRound(rpc(), 2),
    [1, 3],
  );

  expect(blocks.map((b) => Number(b.number)).sort()).toEqual([1, 3]);
});

test("cached sync fails on a null round at a height with logs", async () => {
  const eventCallbacks = await erc20WithMintAtBlock2();

  await expect(
    syncCached(eventCallbacks, withNullRound(rpc(), 2), [1, 2]),
  ).rejects.toThrow("null round");
});

test("in-memory sync skips a null round", async () => {
  const { eventCallbacks } = getBlocksIndexingBuild({ interval: 1 });
  for (let i = 0; i < 3; i++) await simulateBlock();

  const blockData = await syncInMemory(
    eventCallbacks,
    withNullRound(rpc(), 2),
    [1, 3],
  );

  expect(blockData.map((d) => d.cursor)).toEqual([1, 3]);
});

test("in-memory sync fails on a null round at a height with logs", async () => {
  const eventCallbacks = await erc20WithMintAtBlock2();

  await expect(
    syncInMemory(eventCallbacks, withNullRound(rpc(), 2), [1, 2]),
  ).rejects.toThrow("null round");
});
