import { type Hex, numberToHex, zeroAddress } from "viem";
import { beforeEach, expect, test } from "vitest";
import { context, setupCommon } from "@/_test/setup.js";
import { getChain } from "@/_test/utils.js";
import type { LightBlock, SyncBlock } from "@/internal/types.js";
import type { Rpc } from "@/rpc/index.js";
import { drainAsyncGenerator } from "@/utils/generators.js";
import { createRealtimeSync, type RealtimeSyncEvent } from "./index.js";

// Realtime sync on a chain with null rounds: heights where no block exists, as
// on Filecoin. A reorg can change which heights are null, so the local and
// remote chains needn't have blocks at the same heights.

beforeEach(setupCommon);

// The FVM sets every logs bloom bit, so sync never skips a block on its bloom.
const SATURATED_BLOOM = `0x${"f".repeat(512)}` as Hex;

/** A block at `number` on fork `fork`, whose hash encodes both. */
function block(number: number, parent: LightBlock, fork = 0): SyncBlock {
  return {
    number: numberToHex(number),
    hash: `0x${fork.toString(16).padStart(8, "0")}${number.toString(16).padStart(56, "0")}`,
    parentHash: parent.hash,
    timestamp: numberToHex(1_700_000_000 + number * 30),
    logsBloom: SATURATED_BLOOM,
    miner: zeroAddress,
    gasUsed: "0x0",
    gasLimit: "0x0",
    transactions: [],
  } as unknown as SyncBlock;
}

/** Blocks at each listed height, each the child of the one before. */
function chain(from: LightBlock, heights: number[], fork = 0): SyncBlock[] {
  const blocks: SyncBlock[] = [];
  let parent = from;
  for (const height of heights) {
    parent = block(height, parent, fork);
    blocks.push(parent as SyncBlock);
  }
  return blocks;
}

/**
 * Serves `blocks` by number and hash; any other height is a null round. Each
 * response is a fresh copy, as from a real RPC: Ponder mutates blocks it receives.
 */
function rpcServing(blocks: SyncBlock[]): Rpc {
  const byNumber = new Map(blocks.map((b) => [b.number, b]));
  const byHash = new Map(blocks.map((b) => [b.hash, b]));
  return {
    hostnames: ["filecoin"],
    request: async ({
      method,
      params,
    }: {
      method: string;
      params: [Hex, boolean];
    }) => {
      if (method === "eth_getBlockByNumber") {
        const found = byNumber.get(params[0]);
        if (found === undefined) {
          throw Object.assign(new Error("requested epoch was a null round"), {
            cause: { code: 12 },
          });
        }
        return structuredClone(found);
      }
      if (method === "eth_getBlockByHash") {
        const found = byHash.get(params[0]);
        return found === undefined ? null : structuredClone(found);
      }
      throw new Error(`unexpected ${method}`);
    },
    subscribe: () => {},
    unsubscribe: async () => {},
  } as unknown as Rpc;
}

const GENESIS = block(0, { hash: `0x${"0".repeat(64)}` } as LightBlock);

function createSync(rpc: Rpc, finalityBlockCount = 100) {
  return createRealtimeSync({
    common: context.common,
    chain: getChain({ finalityBlockCount }),
    rpc,
    eventCallbacks: [],
    syncProgress: { finalized: GENESIS },
    childAddresses: new Map(),
  });
}

async function syncAll(
  realtimeSync: ReturnType<typeof createSync>,
  blocks: SyncBlock[],
) {
  const events: RealtimeSyncEvent[] = [];
  for (const b of blocks)
    events.push(...(await drainAsyncGenerator(realtimeSync.sync(b))));
  return events;
}

const heights = (realtimeSync: ReturnType<typeof createSync>) =>
  realtimeSync.unfinalizedBlocks.map((b) => b.hash);

test("a local block whose height becomes a null round is reorged out", async () => {
  // Local: 1..7 then 8a. Canonical: 8 is a null round, 9's parent is 7.
  const base = chain(GENESIS, [1, 2, 3, 4, 5, 6, 7]);
  const orphan = block(8, base[6]!, 1);
  const canonical = [...base, ...chain(base[6]!, [9, 10])];
  const realtimeSync = createSync(rpcServing(canonical));

  await syncAll(realtimeSync, [...base, orphan]);
  const events = await syncAll(realtimeSync, [canonical.at(-1)!]);

  expect(events.find((e) => e.type === "reorg")).toMatchObject({
    block: { hash: base[6]!.hash },
    reorgedBlocks: [{ hash: orphan.hash }],
  });
  expect(heights(realtimeSync)).toEqual(canonical.map((b) => b.hash));
});

test("a block at a height the local chain had as a null round is reconciled", async () => {
  // Local: 1..7 then 9a, with 8 a null round. Canonical: 8b, 9b, 10b, 11b.
  const base = chain(GENESIS, [1, 2, 3, 4, 5, 6, 7]);
  const local9 = block(9, base[6]!, 1);
  const fork = chain(base[6]!, [8, 9, 10, 11], 2);
  const realtimeSync = createSync(rpcServing([...base, ...fork]));

  await syncAll(realtimeSync, [...base, local9]);
  const events = await syncAll(realtimeSync, [fork[2]!]);

  expect(events).toMatchObject([
    {
      type: "reorg",
      block: { hash: base[6]!.hash },
      reorgedBlocks: [{ hash: local9.hash }],
    },
  ]);

  await syncAll(realtimeSync, [fork[3]!]);
  expect(heights(realtimeSync)).toEqual([...base, ...fork].map((b) => b.hash));
});

test("a remote chain that joins only below the finalized block is rejected", async () => {
  const local = chain(GENESIS, [1, 2, 3]);
  const genesisB = block(0, { hash: `0x${"1".repeat(64)}` } as LightBlock, 3);
  const other = [genesisB, ...chain(genesisB, [1, 2, 3, 4], 3)];
  const realtimeSync = createSync(rpcServing(other));

  await syncAll(realtimeSync, local);
  const events = await syncAll(realtimeSync, [other.at(-1)!]);

  expect(events.some((e) => e.type === "reorg")).toBe(false);
  expect(heights(realtimeSync)).toEqual(local.map((b) => b.hash));
});

test("a block whose parent is a higher local block is rejected", async () => {
  const local = chain(GENESIS, [1, 2, 3, 4, 5, 6]);
  const realtimeSync = createSync(rpcServing(local));

  await syncAll(realtimeSync, local);
  const events = await syncAll(realtimeSync, [block(3, local[4]!, 4)]);

  expect(events.some((e) => e.type === "reorg")).toBe(false);
  expect(heights(realtimeSync)).toEqual(local.map((b) => b.hash));
});

test("finality advances to the nearest block when the target height is a null round", async () => {
  // Finality 2: block 4 finalizes height 2, which is a null round.
  const blocks = chain(GENESIS, [1, 3, 4]);
  const realtimeSync = createSync(rpcServing(blocks), 2);

  const events = await syncAll(realtimeSync, blocks);

  expect(events.find((e) => e.type === "finalize")).toMatchObject({
    block: { hash: blocks[0]!.hash },
  });
  expect(heights(realtimeSync)).toEqual([blocks[1]!.hash, blocks[2]!.hash]);
});
