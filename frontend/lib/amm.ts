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
const AMM_CONTRACT_NAME = "amm-v2";
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

// Helpers to deal with cvToJSON variations across versions
function getJsonInnerValue(json: any): any {
  if (json && typeof json === "object" && "value" in json) return json.value;
  return json;
}

function isTupleJSON(json: any): boolean {
  if (!json || typeof json !== "object") return false;
  const t = json.type;
  if (t === "tuple") return true;
  if (typeof t === "string" && t.startsWith("(tuple")) return true;
  // Some versions only expose nested .value without an explicit type tag we can rely on
  return !!json.value && typeof json.value === "object" && !Array.isArray(json.value);
}

// Helper: convert a hex string (with or without 0x prefix) to a buffer CV
function hexToBufferCV(hex: string) {
  const clean = typeof hex === "string" && hex.startsWith("0x") ? hex.slice(2) : hex;
  return bufferCV(Buffer.from(clean, "hex"));
}

// Utility: split a contract principal string like "ST123... .token-name" into address and name
function splitContractPrincipal(principal: string): { address: string; name: string } {
  const [address, name] = principal.split(".");
  if (!address || !name) throw new Error(`Invalid contract principal: ${principal}`);
  return { address, name };
}

// Read helpers for fungible tokens (SIP-010 style mock-token)
export async function getTokenBalance(tokenContract: string, who: string): Promise<number> {
  const { address, name } = splitContractPrincipal(tokenContract);
  const res = await callReadOnlyFunction({
    contractAddress: address,
    contractName: name,
    functionName: "get-balance",
    functionArgs: [principalCV(who)],
    senderAddress: AMM_CONTRACT_ADDRESS,
    network,
  });
  const json = cvToJSON(res) as any;
  const okVal = json?.type === "response-ok" || json?.type === "responseOk" ? json.value : json;
  const uintVal = okVal?.type === "uint" ? okVal.value : getJsonInnerValue(okVal);
  return Number(uintVal ?? 0);
}


// Get token decimals from SIP-010 mock-token
export async function getTokenDecimals(tokenContract: string): Promise<number> {
  const { address, name } = splitContractPrincipal(tokenContract);
  const res = await callReadOnlyFunction({
    contractAddress: address,
    contractName: name,
    functionName: "get-decimals",
    functionArgs: [],
    senderAddress: AMM_CONTRACT_ADDRESS,
    network,
  });
  const json = cvToJSON(res) as any;
  const okVal = json?.type === "response-ok" || json?.type === "responseOk" ? json.value : json;
  const val = getJsonInnerValue(okVal);
  // Accept shapes: {type:'uint', value:'6'} | '6' | 'u6'
  const decStr = typeof val === "object" && val?.type === "uint" ? val.value : val;
  if (typeof decStr === "number") return decStr;
  if (typeof decStr === "string") {
    const m = decStr.match(/^\s*u?(\d+)\s*$/);
    if (m) return Number(m[1]);
  }
  throw new Error(`Invalid decimals response for ${tokenContract}: ${JSON.stringify(json)}`);
}

// Convert a token amount (potentially decimal) to base units using decimals
export function toBaseUnits(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid amount: must be a non-negative number");
  if (!Number.isInteger(decimals) || decimals < 0) throw new Error("Invalid token decimals");
  const [intPart, fracRaw] = amount.toString().split(".");
  const fracPart = (fracRaw || "").padEnd(decimals, "0").slice(0, decimals);
  const base = 10n ** BigInt(decimals);
  const intUnits = BigInt(intPart || "0") * base;
  const fracUnits = BigInt(fracPart || "0");
  return intUnits + fracUnits;
}

// Mint/Faucet helpers (note: mint on current mock-token is owner-only)
export async function mintToken(tokenContract: string, amount: number, recipient: string) {
  const { address, name } = splitContractPrincipal(tokenContract);
  return {
    contractAddress: address,
    contractName: name,
    functionName: "mint",
    functionArgs: [uintCV(amount), principalCV(recipient)],
  };
}

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
      const res = await fetch(url, { cache: 'no-store' });
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

          // Accept both explicit "tuple" and string-descriptive tuple types
          if (!isTupleJSON(data)) continue;

          const dataValue = getJsonInnerValue(data);
          const actionField = dataValue?.action;
          const actionValue = getJsonInnerValue(actionField);
          const actionStr = typeof actionValue === "string" ? actionValue : undefined;
          if (actionStr !== "create-pool") continue;

          const innerDataField = dataValue?.data;
          const innerData = getJsonInnerValue(innerDataField);
          if (!innerData || typeof innerData !== "object") continue;

          const token0 = getJsonInnerValue(innerData["token-0"]);
          const token1 = getJsonInnerValue(innerData["token-1"]);
          const fee = Number(getJsonInnerValue(innerData.fee));

          console.log("Found create-pool event:", { token0, token1, fee });

          // Canonicalize token order by principal hex to match contract expectations
          let canon0 = token0;
          let canon1 = token1;
          try {
            const t0Hex = cvToHex(principalCV(token0));
            const t1Hex = cvToHex(principalCV(token1));
            if (t0Hex > t1Hex) {
              canon0 = token1;
              canon1 = token0;
            }
          } catch (_) {
            // fall back to event order if principal parsing fails
          }

          let poolBuilt: Pool | null = null;

          try {
            // Get pool ID
            const poolIdResult = await callReadOnlyFunction({
              contractAddress: AMM_CONTRACT_ADDRESS,
              contractName: AMM_CONTRACT_NAME,
              functionName: "get-pool-id",
              functionArgs: [
                Cl.tuple({
                  "token-0": principalCV(canon0),
                  "token-1": principalCV(canon1),
                  fee: uintCV(fee),
                }),
              ],
              senderAddress: AMM_CONTRACT_ADDRESS,
              network,
            });

            let poolIdCV = cvToJSON(poolIdResult) as any;
            console.log("Pool ID result:", poolIdCV);

            // Handle different tag names across versions
            if (poolIdCV?.type === "response-ok" || poolIdCV?.type === "responseOk") poolIdCV = poolIdCV.value;
            if (poolIdCV?.type === "optional-some" || poolIdCV?.type === "optionalSome") poolIdCV = poolIdCV.value;

            if (poolIdCV?.type === "buffer" || poolIdCV?.type === "buff") {
              const poolId = poolIdCV.value;
              console.log("Pool ID:", poolId);

              // Fetch pool data
              const poolDataResult = await callReadOnlyFunction({
                contractAddress: AMM_CONTRACT_ADDRESS,
                contractName: AMM_CONTRACT_NAME,
                functionName: "get-pool-data",
                functionArgs: [hexToBufferCV(poolId)],
                senderAddress: AMM_CONTRACT_ADDRESS,
                network,
              });

              const poolDataJSON = cvToJSON(poolDataResult) as any;
              console.log("Pool data result:", poolDataJSON);

              // Accept variations in response/optional tags and tuple detection
              let okPart = poolDataJSON;
              if (okPart?.type === "response-ok" || okPart?.type === "responseOk") okPart = okPart.value;
              if (okPart?.type === "optional-some" || okPart?.type === "optionalSome") okPart = okPart.value;
              if (isTupleJSON(okPart)) {
                const poolData = getJsonInnerValue(okPart);
                poolBuilt = {
                  id: poolId,
                  "token-0": canon0,
                  "token-1": canon1,
                  fee,
                  liquidity: Number(getJsonInnerValue(poolData.liquidity)),
                  "balance-0": Number(getJsonInnerValue(poolData["balance-0"])),
                  "balance-1": Number(getJsonInnerValue(poolData["balance-1"])),
                };
              }
            }
          } catch (innerErr) {
            console.warn("Read-only calls failed, will fallback to event data:", innerErr);
          }

          if (!poolBuilt) {
            // Fallback: build pool from event payload to at least render it
            const b0 = Number(getJsonInnerValue(innerData["balance-0"]) ?? 0);
            const b1 = Number(getJsonInnerValue(innerData["balance-1"]) ?? 0);
            const balances = canon0 === token0 ? [b0, b1] : [b1, b0];
            poolBuilt = {
              id: `${canon0}-${canon1}-${fee}`,
              "token-0": canon0,
              "token-1": canon1,
              fee,
              liquidity: Number(getJsonInnerValue(innerData.liquidity) ?? 0),
              "balance-0": balances[0],
              "balance-1": balances[1],
            } as Pool;
            // Attempt direct resolution for hex ID even if event-based read failed
            try {
              const resolved = await resolvePoolByPair(canon0, canon1, fee);
              if (resolved) poolBuilt = resolved;
            } catch (_) {
              // ignore and keep fallback; will attempt again in merge step below
            }
          }

          console.log("Adding pool:", poolBuilt);
          pools.push(poolBuilt);
        } catch (error) {
          console.error("Error processing event:", error);
          continue;
        }
      }
      // advance pagination window
      offset += 50;
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

  // Merge with direct approach to replace any fallback/event-only entries
  try {
    const directPools = await getAllPoolsDirect();
    const directByPair = new Map<string, Pool>();
    for (const dp of directPools) {
      const key = `${dp["token-0"]}|${dp["token-1"]}|${dp.fee}`;
      directByPair.set(key, dp);
    }
    const isHexId = (id: string) => {
      const s = (id || "").startsWith("0x") ? id.slice(2) : id;
      return /^[0-9a-fA-F]+$/.test(s) && s.length > 0;
    };
    for (let i = 0; i < pools.length; i++) {
      const p = pools[i];
      const key = `${p["token-0"]}|${p["token-1"]}|${p.fee}`;
      const dp = directByPair.get(key);
      const looksFallback = !isHexId(p.id) || (p["balance-0"] === 0 && p["balance-1"] === 0);
      if (dp && looksFallback) {
        pools[i] = dp;
      }
    }
  } catch (mergeErr) {
    console.warn("Failed to merge with direct pools:", mergeErr);
  }

  // Deduplicate by token pair + fee, prefer entries with hex buffer IDs
  const byPair = new Map<string, Pool>();
  const isHexId = (id: string) => {
    const s = (id || "").startsWith("0x") ? id.slice(2) : id;
    return /^[0-9a-fA-F]+$/.test(s) && s.length > 0;
  };
  for (const p of pools) {
    const key = `${p["token-0"]}|${p["token-1"]}|${p.fee}`;
    const existing = byPair.get(key);
    if (!existing) {
      byPair.set(key, p);
      continue;
    }
    if (isHexId(p.id) && !isHexId(existing.id)) {
      byPair.set(key, p);
    }
  }
  const deduped = Array.from(byPair.values());

  // Final fix-up pass: resolve any remaining fallback IDs to hex via direct read
  for (let i = 0; i < deduped.length; i++) {
    const p = deduped[i];
    if (!isHexId(p.id)) {
      try {
        const resolved = await resolvePoolByPair(p["token-0"], p["token-1"], p.fee);
        if (resolved) deduped[i] = resolved;
      } catch (_) {
        // keep fallback if resolution fails
      }
    }
  }
  return deduped;
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
    "ST19JE8EPR84AJ8Z30B5ZB08WXTB6FC2SQHT4K9RM.mock-token-2",
    "ST19JE8EPR84AJ8Z30B5ZB08WXTB6FC2SQHT4K9RM.mock-token-3",
    "ST19JE8EPR84AJ8Z30B5ZB08WXTB6FC2SQHT4K9RM.mock-token-4",
    "ST19JE8EPR84AJ8Z30B5ZB08WXTB6FC2SQHT4K9RM.mock-token-5",
    "ST19JE8EPR84AJ8Z30B5ZB08WXTB6FC2SQHT4K9RM.mock-token-6",
  ];

  const fees = [500]; // Trimmed to common 0.5% fee for minimal fallback

  for (let i = 0; i < knownTokens.length; i++) {
    for (let j = i + 1; j < knownTokens.length; j++) {
      for (const fee of fees) {
        // Try both token orders to be safe
        const orders: Array<[string, string]> = [
          [knownTokens[i], knownTokens[j]],
          [knownTokens[j], knownTokens[i]],
        ];
        for (const [token0, token1] of orders) {
          try {
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

            let poolExistsJSON = cvToJSON(poolExistsResult) as any;
            if (poolExistsJSON?.type === "response-ok" || poolExistsJSON?.type === "responseOk") {
              poolExistsJSON = poolExistsJSON.value;
            }
            const existsVal = getJsonInnerValue(poolExistsJSON);
            const exists = typeof existsVal === "boolean" ? existsVal : poolExistsJSON?.value === true;
            if (!exists) continue; // Pool doesn't exist

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
            if (poolIdCV?.type === "response-ok" || poolIdCV?.type === "responseOk") poolIdCV = poolIdCV.value;
            if (poolIdCV?.type === "optional-some" || poolIdCV?.type === "optionalSome") poolIdCV = poolIdCV.value;
            if (!(poolIdCV?.type === "buffer" || poolIdCV?.type === "buff")) continue;
            const poolId = poolIdCV.value;

            // Fetch pool data
            const poolDataResult = await callReadOnlyFunction({
              contractAddress: AMM_CONTRACT_ADDRESS,
              contractName: AMM_CONTRACT_NAME,
              functionName: "get-pool-data",
              functionArgs: [hexToBufferCV(poolId)],
              senderAddress: AMM_CONTRACT_ADDRESS,
              network,
            });

            let poolDataJSON = cvToJSON(poolDataResult) as any;
            if (poolDataJSON?.type === "response-ok" || poolDataJSON?.type === "responseOk") poolDataJSON = poolDataJSON.value;
            if (poolDataJSON?.type === "optional-some" || poolDataJSON?.type === "optionalSome") poolDataJSON = poolDataJSON.value;
            if (!isTupleJSON(poolDataJSON)) continue;
            const poolData = getJsonInnerValue(poolDataJSON);

            pools.push({
              id: poolId,
              "token-0": token0,
              "token-1": token1,
              fee,
              liquidity: Number(getJsonInnerValue(poolData.liquidity)),
              "balance-0": Number(getJsonInnerValue(poolData["balance-0"])),
              "balance-1": Number(getJsonInnerValue(poolData["balance-1"])),
            });

            console.log("Found pool via direct approach:", { token0, token1, fee });
          } catch (error) {
            // Pool doesn't exist or error occurred, try next order/fee
            continue;
          }
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

  // Convert user-entered token amounts to base units using decimals
  const dec0 = await getTokenDecimals(pool["token-0"]);
  const dec1 = await getTokenDecimals(pool["token-1"]);
  const amount0Base = toBaseUnits(amount0, dec0);
  const amount1Base = toBaseUnits(amount1, dec1);

  // Preflight for non-initial pools: respect ratio using base units
  if (pool.liquidity > 0) {
    const poolRatio = pool["balance-0"] / pool["balance-1"];
    const idealAmount1Base = Math.floor(Number(amount0Base) / poolRatio);
    if (Number(amount1Base) < idealAmount1Base) {
      const t1 = pool["token-1"].split(".")[1];
      const t0 = pool["token-0"].split(".")[1];
      throw new Error(
        `You need at least ${idealAmount1Base} base units of ${t1} with ${amount0Base} base units of ${t0}`
      );
    }
  } else {
    // Initial liquidity must satisfy sqrt(x*y) > MINIMUM_LIQUIDITY (u1000)
    const sqrtProduct = Math.floor(Math.sqrt(Number(amount0Base) * Number(amount1Base)));
    const MINIMUM_LIQUIDITY = 1000; // mirrors contract constant
    if (sqrtProduct <= MINIMUM_LIQUIDITY) {
      throw new Error(
        `Initial deposit too small. Increase amounts so sqrt(x*y) > ${MINIMUM_LIQUIDITY} (in base units).`
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
      uintCV(amount0Base),
      uintCV(amount1Base),
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
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Swap amount must be a positive number");
  }

  // Convert input amount to base units using decimals of the input token
  const fromToken = zeroForOne ? pool["token-0"] : pool["token-1"];
  const dec = await getTokenDecimals(fromToken);
  const amountBase = toBaseUnits(amount, dec);

  return {
    contractAddress: AMM_CONTRACT_ADDRESS,
    contractName: AMM_CONTRACT_NAME,
    functionName: "swap",
    functionArgs: [
      principalCV(pool["token-0"]),
      principalCV(pool["token-1"]),
      uintCV(pool.fee),
      uintCV(amountBase),
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
    functionArgs: [hexToBufferCV(pool.id), principalCV(user)],
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

// Resolve a pool by token pair and fee using read-only contract calls
async function resolvePoolByPair(token0In: string, token1In: string, fee: number): Promise<Pool | null> {
  try {
    // Canonicalize order by principal hex to match contract expectations
    let token0 = token0In;
    let token1 = token1In;
    const t0Hex = cvToHex(principalCV(token0));
    const t1Hex = cvToHex(principalCV(token1));
    if (t0Hex > t1Hex) {
      token0 = token1In;
      token1 = token0In;
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
    if (poolIdCV?.type === "response-ok" || poolIdCV?.type === "responseOk") poolIdCV = poolIdCV.value;
    if (poolIdCV?.type === "optional-some" || poolIdCV?.type === "optionalSome") poolIdCV = poolIdCV.value;
    if (!(poolIdCV?.type === "buffer" || poolIdCV?.type === "buff")) return null;
    const poolId = poolIdCV.value as string; // e.g., "0x..."

    // Get pool data
    const poolDataResult = await callReadOnlyFunction({
      contractAddress: AMM_CONTRACT_ADDRESS,
      contractName: AMM_CONTRACT_NAME,
      functionName: "get-pool-data",
      functionArgs: [hexToBufferCV(poolId)],
      senderAddress: AMM_CONTRACT_ADDRESS,
      network,
    });

    let poolDataJSON = cvToJSON(poolDataResult) as any;
    if (poolDataJSON?.type === "response-ok" || poolDataJSON?.type === "responseOk") poolDataJSON = poolDataJSON.value;
    if (poolDataJSON?.type === "optional-some" || poolDataJSON?.type === "optionalSome") poolDataJSON = poolDataJSON.value;
    if (!isTupleJSON(poolDataJSON)) return null;
    const poolData = getJsonInnerValue(poolDataJSON);

    return {
      id: poolId,
      "token-0": token0,
      "token-1": token1,
      fee,
      liquidity: Number(getJsonInnerValue(poolData.liquidity)),
      "balance-0": Number(getJsonInnerValue(poolData["balance-0"])),
      "balance-1": Number(getJsonInnerValue(poolData["balance-1"])),
    };
  } catch (_) {
    return null;
  }
}
