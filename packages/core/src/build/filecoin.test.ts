import { beforeEach, expect, test } from "vitest";
import { context, setupCommon } from "@/_test/setup.js";
import { TEST_POOL_ID } from "@/_test/utils.js";
import { createConfig } from "@/config/index.js";
import { buildConfig } from "./config.js";

beforeEach(setupCommon);

const filecoinConfig = (reorgWindow?: number) =>
  createConfig({
    chains: {
      filecoin: {
        id: 314,
        rpc: `http://127.0.0.1:8545/${TEST_POOL_ID}`,
        reorgWindow,
      },
    },
    blocks: { b: { chain: "filecoin" } },
  });

test("buildConfig() defaults the Filecoin reorg window to 600 seconds", () => {
  const { chains } = buildConfig({
    common: context.common,
    config: filecoinConfig(),
  });

  expect(chains[0]!.reorgWindow).toBe(600);
});

test("buildConfig() uses a configured Filecoin reorg window", () => {
  const { chains } = buildConfig({
    common: context.common,
    config: filecoinConfig(120),
  });

  expect(chains[0]!.reorgWindow).toBe(120);
});
