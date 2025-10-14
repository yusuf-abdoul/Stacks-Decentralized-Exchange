import { StacksTestnet } from "@stacks/network";
import {
  boolCV,
  bufferCV,
  Cl,
  cvToHex,
  callReadOnlyFunction,
  cvToJSON,
  hexToCV,
  principalCV,
  uintCV,
} from "@stacks/transactions";

const AMM_CONTRACT_ADDRESS = "ST19JE8EPR84AJ8Z30B5ZB08WXTB6FC2SQHT4K9RM";
const AMM_CONTRACT_NAME = "amm";
const AMM_CONTRACT_PRINCIPAL = `${AMM_CONTRACT_ADDRESS}.${AMM_CONTRACT_NAME}`;
const network = new StacksTestnet();

type ContractEvent = {
  event_index: number;
  event_type: string;
  tx_id: string;
  contract_log: {
    contract_id: string;
    topic: string;
    value: {
      hex: string;
      repr: string;
    };
  };
};

export type Pool = {
  id: string;
  "token-0": string;
  "token-1": string;
  fee: number;
  liquidity: number;
  "balance-0": number;
  "balance-1": number;
};

/**
 * Fetch all pool creation events from the AMM contract.
 * Returns a list of pools with their basic data.
 */
export async function getAllPools(): Promise<Pool[]> {
  let offset = 0;
  let done = false;
  const pools: Pool[] = [];

  console.log("Starting to fetch pools from contract events...");

  while (!done) {
    const url = `https://api.testnet.hiro.so/extended/v1/contract/${AMM_CONTRACT_PRINCIPAL}/events?limit=50&offset=${offset}`;
    console.log(`Fetching events from: ${url}`);

    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`Failed to fetch events: ${res.status} ${res.statusText}`);
        break;
      }

      const json = await res.json();
      const events = json.results as ContractEvent[];
      console.log(`Fetched ${events.length} events`);

      if (events.length < 50) done = true;

      const filteredEvents = events.filter(
        (event) =>
          event.event_type === "smart_contract_log" &&
          event.contract_log.contract_id === AMM_CONTRACT_PRINCIPAL &&
          event.contract_log.topic === "print"
      );

      console.log(`Found ${filteredEvents.length} print events`);

      for (const event of filteredEvents) {
        try {
          const clarityVal = hexToCV(event.contract_log.value.hex);
          const data = cvToJSON(clarityVal) as any;

          // Log once for debugging
          console.log("Event JSON:", JSON.stringify(data, null, 2));

          if (data.type !== "tuple") continue;

          const action = data.value?.action;
          if (
            !action ||
            (action.type !== "ascii" && action.type !== "string-ascii") ||
            action.value !== "create-pool"
          )
            continue;

          const dataField = data.value?.data;
          if (!dataField || dataField.type !== "tuple") continue;

          const poolInitialData = dataField.value;

          const token0 = poolInitialData["token-0"].value;
          const token1 = poolInitialData["token-1"].value;
          const fee = Number(poolInitialData.fee.value);

          console.log("Found create-pool event:", { token0, token1, fee });

          // Get pool ID
          const poolIdResult = await callReadOnlyFunction({
            contractAddress: AMM_CONTRACT_ADDRESS,
            contractName: AMM_CONTRACT_NAME,
            functionName: "get-pool-id",
            functionArgs: [
              Cl.tuple({
                "token-0": principalCV(token0),
                "token-1": principalCV(token1),
                fee: uintCV(fee),
              }),
            ],
            senderAddress: AMM_CONTRACT_ADDRESS,
            network,
          });

          let poolIdCV = cvToJSON(poolIdResult) as any;
          console.log("Pool ID result:", poolIdCV);

          if (poolIdCV.type === "response-ok") poolIdCV = poolIdCV.value;
          if (poolIdCV.type === "optional-some") poolIdCV = poolIdCV.value;

          if (poolIdCV.type !== "buffer") {
            console.warn("Skipping pool — unexpected poolId type:", poolIdCV);
            continue;
          }

          const poolId = poolIdCV.value;
          console.log("Pool ID:", poolId);

          // Fetch pool data
          const poolDataResult = await callReadOnlyFunction({
            contractAddress: AMM_CONTRACT_ADDRESS,
            contractName: AMM_CONTRACT_NAME,
            functionName: "get-pool-data",
            functionArgs: [hexToCV(poolId)],
            senderAddress: AMM_CONTRACT_ADDRESS,
            network,
          });

          const poolDataJSON = cvToJSON(poolDataResult) as any;
          console.log("Pool data result:", poolDataJSON);

          if (
            poolDataJSON.type !== "response-ok" ||
            poolDataJSON.value.type !== "optional-some" ||
            poolDataJSON.value.value.type !== "tuple"
          ) {
            console.warn("Skipping pool — invalid pool data:", poolDataJSON);
            continue;
          }

          const poolData = poolDataJSON.value.value.value;

          const pool: Pool = {
            id: poolId,
            "token-0": token0,
            "token-1": token1,
            fee,
            liquidity: Number(poolData.liquidity.value),
            "balance-0": Number(poolData["balance-0"].value),
            "balance-1": Number(poolData["balance-1"].value),
          };

          console.log("Adding pool:", pool);
          pools.push(pool);

          offset = event.event_index;
        } catch (error) {
          console.error("Error processing event:", error);
          continue;
        }
      }
    } catch (error) {
      console.error("Error fetching events:", error);
      break;
    }
  }

  console.table(pools);
  console.log(`Successfully fetched ${pools.length} pools:`, pools);

  // If no pools found via events, try to fetch known pools directly
  if (pools.length === 0) {
    console.log("No pools found via events, trying direct approach...");
    return await getAllPoolsDirect();
  }

  return pools;
}

/**
 * Alternative approach: Try to fetch pools by checking known token pairs
 * This is a fallback when the event-based approach doesn't work
 */
async function getAllPoolsDirect(): Promise<Pool[]> {
  const pools: Pool[] = [];

  // Common token pairs to check (you can expand this list)
  const knownTokens = [
    "ST19JE8EPR84AJ8Z30B5ZB08WXTB6FC2SQHT4K9RM.mock-token",
    // Add more known token addresses here
  ];

  const fees = [300, 500, 1000, 3000, 10000]; // Common fee tiers

  for (let i = 0; i < knownTokens.length; i++) {
    for (let j = i + 1; j < knownTokens.length; j++) {
      for (const fee of fees) {
        try {
          const token0 = knownTokens[i];
          const token1 = knownTokens[j];

          // First check if pool exists
          const poolExistsResult = await callReadOnlyFunction({
            contractAddress: AMM_CONTRACT_ADDRESS,
            contractName: AMM_CONTRACT_NAME,
            functionName: "pool-exists",
            functionArgs: [
              principalCV(token0),
              principalCV(token1),
              uintCV(fee),
            ],
            senderAddress: AMM_CONTRACT_ADDRESS,
            network,
          });

          const poolExistsJSON = cvToJSON(poolExistsResult) as any;
          if (
            poolExistsJSON.type !== "response-ok" ||
            poolExistsJSON.value.type !== "bool" ||
            !poolExistsJSON.value.value
          ) {
            continue; // Pool doesn't exist
          }

          // Get pool ID
          const poolIdResult = await callReadOnlyFunction({
            contractAddress: AMM_CONTRACT_ADDRESS,
            contractName: AMM_CONTRACT_NAME,
            functionName: "get-pool-id",
            functionArgs: [
              Cl.tuple({
                "token-0": principalCV(token0),
                "token-1": principalCV(token1),
                fee: uintCV(fee),
              }),
            ],
            senderAddress: AMM_CONTRACT_ADDRESS,
            network,
          });

          let poolIdCV = cvToJSON(poolIdResult) as any;
          if (poolIdCV.type === "response-ok") poolIdCV = poolIdCV.value;
          if (poolIdCV.type === "optional-some") poolIdCV = poolIdCV.value;

          if (poolIdCV.type !== "buffer") continue;

          const poolId = poolIdCV.value;

          // Fetch pool data
          const poolDataResult = await callReadOnlyFunction({
            contractAddress: AMM_CONTRACT_ADDRESS,
            contractName: AMM_CONTRACT_NAME,
            functionName: "get-pool-data",
            functionArgs: [hexToCV(poolId)],
            senderAddress: AMM_CONTRACT_ADDRESS,
            network,
          });

          const poolDataJSON = cvToJSON(poolDataResult) as any;
          if (
            poolDataJSON.type !== "response-ok" ||
            poolDataJSON.value.type !== "optional-some" ||
            poolDataJSON.value.value.type !== "tuple"
          ) continue;

          const poolData = poolDataJSON.value.value.value;

          pools.push({
            id: poolId,
            "token-0": token0,
            "token-1": token1,
            fee,
            liquidity: Number(poolData.liquidity.value),
            "balance-0": Number(poolData["balance-0"].value),
            "balance-1": Number(poolData["balance-1"].value),
          });

          console.log("Found pool via direct approach:", { token0, token1, fee });
        } catch (error) {
          // Pool doesn't exist or error occurred, continue
          continue;
        }
      }
    }
  }

  console.log(`Found ${pools.length} pools via direct approach`);
  return pools;
}


/**
 * Create pool transaction options
 */
export async function createPool(token0: string, token1: string, fee: number) {
  const token0Hex = cvToHex(principalCV(token0));
  const token1Hex = cvToHex(principalCV(token1));
  if (token0Hex > token1Hex) {
    [token0, token1] = [token1, token0];
  }

  return {
    contractAddress: AMM_CONTRACT_ADDRESS,
    contractName: AMM_CONTRACT_NAME,
    functionName: "create-pool",
    functionArgs: [principalCV(token0), principalCV(token1), uintCV(fee)],
  };
}

/**
 * Add liquidity to pool
 */
export async function addLiquidity(
  pool: Pool,
  amount0: number,
  amount1: number
) {
  if (amount0 === 0 || amount1 === 0)
    throw new Error("Cannot add liquidity with 0 amount");

  if (pool.liquidity > 0) {
    const poolRatio = pool["balance-0"] / pool["balance-1"];
    const idealAmount1 = Math.floor(amount0 / poolRatio);
    if (amount1 < idealAmount1) {
      throw new Error(
        `You need at least ${idealAmount1} ${pool["token-1"].split(".")[1]
        } with ${amount0} ${pool["token-0"].split(".")[1]}`
      );
    }
  }

  return {
    contractAddress: AMM_CONTRACT_ADDRESS,
    contractName: AMM_CONTRACT_NAME,
    functionName: "add-liquidity",
    functionArgs: [
      principalCV(pool["token-0"]),
      principalCV(pool["token-1"]),
      uintCV(pool.fee),
      uintCV(amount0),
      uintCV(amount1),
      uintCV(0),
      uintCV(0),
    ],
  };
}

/**
 * Remove liquidity from pool
 */
export async function removeLiquidity(pool: Pool, liquidity: number) {
  return {
    contractAddress: AMM_CONTRACT_ADDRESS,
    contractName: AMM_CONTRACT_NAME,
    functionName: "remove-liquidity",
    functionArgs: [
      principalCV(pool["token-0"]),
      principalCV(pool["token-1"]),
      uintCV(pool.fee),
      uintCV(liquidity),
    ],
  };
}

/**
 * Swap tokens in a pool
 */
export async function swap(pool: Pool, amount: number, zeroForOne: boolean) {
  return {
    contractAddress: AMM_CONTRACT_ADDRESS,
    contractName: AMM_CONTRACT_NAME,
    functionName: "swap",
    functionArgs: [
      principalCV(pool["token-0"]),
      principalCV(pool["token-1"]),
      uintCV(pool.fee),
      uintCV(amount),
      boolCV(zeroForOne),
    ],
  };
}

/**
 * Get user’s liquidity in a specific pool
 */
export async function getUserLiquidity(pool: Pool, user: string) {
  const userLiquidityResult = await callReadOnlyFunction({
    contractAddress: AMM_CONTRACT_ADDRESS,
    contractName: AMM_CONTRACT_NAME,
    functionName: "get-position-liquidity",
    functionArgs: [bufferCV(Buffer.from(pool.id, "hex")), principalCV(user)],
    senderAddress: AMM_CONTRACT_ADDRESS,
    network,
  });

  const json = cvToJSON(userLiquidityResult) as any;
  if (json.type !== "response-ok" || json.value.type !== "uint") return 0;
  return parseInt(json.value.value.toString());
}

// Export all
export default {
  getAllPools,
  createPool,
  addLiquidity,
  removeLiquidity,
  swap,
  getUserLiquidity,
};
