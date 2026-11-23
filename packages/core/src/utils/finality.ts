import { hexToNumber } from "viem";
import type { Chain, LightBlock } from "@/internal/types.js";
import { eth_getBlockAtOrBelow, eth_getBlockByNumber } from "@/rpc/actions.js";
import type { Rpc } from "@/rpc/index.js";

export const DEFAULT_REORG_WINDOW = 180;

/** Filecoin mainnet (314) and calibnet (314159). */
export const isFilecoinChain = (chainId: number) =>
  chainId === 314 || chainId === 314159;

/**
 * The maximum `reorgWindow`, 20 Filecoin epochs. Filecoin produces a block every
 * 30 seconds, so the default window would span only 6.
 */
export const FILECOIN_REORG_WINDOW = 600;

export const isAsyncExecutionChain = (chainId: number) =>
  chainId === 143 ||
  chainId === 10143 ||
  chainId === 43114 ||
  chainId === 43113;

/**
 * Finds a block whose timestamp is outside the reorg window.
 * Block timestamps are monotonic, so a binary search avoids retaining or
 * fetching one block per second on fast chains.
 */
export async function getFinalizedBlock({
  chain,
  rpc,
  latestBlock,
  lowerBound,
}: {
  chain: Chain;
  rpc: Rpc;
  latestBlock: LightBlock;
  lowerBound?: LightBlock;
}): Promise<LightBlock> {
  const { reorgWindow } = chain;
  if (reorgWindow === 0) return latestBlock;

  const targetTimestamp = hexToNumber(latestBlock.timestamp) - reorgWindow;

  if (
    lowerBound !== undefined &&
    hexToNumber(lowerBound.timestamp) > targetTimestamp
  ) {
    return lowerBound;
  }

  let low = lowerBound ? hexToNumber(lowerBound.number) + 1 : 0;
  let high = hexToNumber(latestBlock.number);
  let finalizedBlock = lowerBound;

  const blockTimeSeconds =
    chain.viemChain?.blockTime === undefined || chain.viemChain.blockTime <= 0
      ? 1
      : chain.viemChain.blockTime / 1_000;
  const estimatedBlockCount = Math.ceil(reorgWindow / blockTimeSeconds);
  const estimatedBlockNumber = high - estimatedBlockCount;
  let blockNumber = Math.max(low, Math.min(estimatedBlockNumber, high));

  while (low <= high) {
    // A null round (Filecoin) at `blockNumber` yields the nearest block below it.
    const block = await eth_getBlockAtOrBelow(rpc, blockNumber, {
      retryNullBlockRequest: true,
    });

    if (hexToNumber(block.timestamp) <= targetTimestamp) {
      finalizedBlock = block;
      low = blockNumber + 1;
    } else {
      high = blockNumber - 1;
    }

    if (low > high) break;
    blockNumber = Math.floor((low + high) / 2);
  }

  if (finalizedBlock === undefined) {
    return eth_getBlockByNumber(rpc, ["0x0", false], {
      retryNullBlockRequest: true,
    });
  }

  return finalizedBlock;
}
