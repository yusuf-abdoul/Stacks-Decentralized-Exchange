"use client";

import { useStacks } from "@/hooks/use-stacks";
import { Pool, getTokenDecimals, toBaseUnits } from "@/lib/amm";
import { useEffect, useMemo, useState } from "react";

export interface SwapProps {
  pools: Pool[];
}

export function Swap({ pools }: SwapProps) {
  const { handleSwap, handleMint, readTokenBalance, userData } = useStacks();
  const [fromToken, setFromToken] = useState<string>(pools[0]["token-0"]);
  const [toToken, setToToken] = useState<string>(pools[0]["token-1"]);
  const [fromAmount, setFromAmount] = useState<number>(0);
  const [estimatedToAmount, setEstimatedToAmount] = useState<bigint>(BigInt(0));
  const [fromBalance, setFromBalance] = useState<number | null>(null);
  const [toBalance, setToBalance] = useState<number | null>(null);
  const [disabledReason, setDisabledReason] = useState<string | null>(null);
  const [selectedPoolFee, setSelectedPoolFee] = useState<number | null>(null);

  const uniqueTokens = pools.reduce((acc, pool) => {
    const token0 = pool["token-0"];
    const token1 = pool["token-1"];

    if (!acc.includes(token0)) {
      acc.push(token0);
    }

    if (!acc.includes(token1)) {
      acc.push(token1);
    }

    return acc;
  }, [] as string[]);

  const toTokensList = useMemo(() => {
    const poolsWithFromToken = pools.filter(
      (pool) => pool["token-0"] === fromToken || pool["token-1"] === fromToken
    );
    const tokensFromPools = poolsWithFromToken.reduce((acc, pool) => {
      const token0 = pool["token-0"];
      const token1 = pool["token-1"];

      if (!acc.includes(token0) && token0 !== fromToken) {
        acc.push(token0);
      }

      if (!acc.includes(token1) && token1 !== fromToken) {
        acc.push(token1);
      }

      return acc;
    }, [] as string[]);

    return tokensFromPools;
  }, [fromToken, pools]);

  // Ensure toToken always matches a valid pair with fromToken
  useEffect(() => {
    if (!toTokensList.includes(toToken)) {
      if (toTokensList.length > 0) {
        setToToken(toTokensList[0]);
      } else {
        // No valid pair for this fromToken; keep current but estimator will disable
      }
    }
  }, [fromToken, toTokensList]);

  async function estimateSwapOutput() {
    const pool = selectBestPool(fromToken, toToken, pools);
    if (!pool) {
      setEstimatedToAmount(0n);
      setDisabledReason("No pool exists for the selected pair");
      setSelectedPoolFee(null);
      return;
    }
    setSelectedPoolFee(pool.fee);
    if (!Number.isFinite(fromAmount) || fromAmount <= 0) {
      setEstimatedToAmount(0n);
      setDisabledReason("Enter a positive amount");
      return;
    }

    const zeroForOne = fromToken === pool["token-0"];
    const x = BigInt(pool["balance-0"]);
    const y = BigInt(pool["balance-1"]);
    const k = x * y;

    // Guard against empty pools
    if (x <= 0n || y <= 0n) {
      setEstimatedToAmount(0n);
      setDisabledReason("Pool has zero reserves");
      return;
    }

    // Convert input amount to base units using decimals of the input token
    const fromDecimals = await getTokenDecimals(fromToken);
    const deltaBaseUnits = toBaseUnits(fromAmount, fromDecimals);
    if (deltaBaseUnits <= 0n) {
      setEstimatedToAmount(0n);
      setDisabledReason("Amount too small after decimals conversion");
      return;
    }

    let output: bigint;
    if (zeroForOne) {
      // Contract math: output = y - k / (x + dx)
      const xPlus = x + deltaBaseUnits;
      if (xPlus <= 0n) {
        setEstimatedToAmount(0n);
        setDisabledReason("Invalid pool state for swap");
        return;
      }
      const term = k / xPlus;
      output = y - term;
    } else {
      // Contract math: output = x - k / (y + dy)
      const yPlus = y + deltaBaseUnits;
      if (yPlus <= 0n) {
        setEstimatedToAmount(0n);
        setDisabledReason("Invalid pool state for swap");
        return;
      }
      const term = k / yPlus;
      output = x - term;
    }

    if (output <= 0n) {
      setEstimatedToAmount(0n);
      setDisabledReason("Output is zero; try a larger amount");
      return;
    }

    // Apply fees: fees = (output * fee) / 10000
    const feeNumerator = BigInt(pool.fee);
    const feeDenom = 10000n;
    const fees = (output * feeNumerator) / feeDenom;
    const outputAfterFees = output - fees;

    setEstimatedToAmount(outputAfterFees > 0n ? outputAfterFees : 0n);
    setDisabledReason(outputAfterFees > 0n ? null : "Output becomes zero after fees");
  }

  useEffect(() => {
    void estimateSwapOutput();
  }, [fromToken, toToken, fromAmount]);

  useEffect(() => {
    async function loadTokenInfo() {
      try {
        if (userData) {
          const [fb, tb] = await Promise.all([
            readTokenBalance(fromToken),
            readTokenBalance(toToken),
          ]);
          setFromBalance(fb);
          setToBalance(tb);
        } else {
          setFromBalance(null);
          setToBalance(null);
        }
      } catch (e) {
        console.warn("Failed to read token balances", e);
      }
    }
    loadTokenInfo();
  }, [fromToken, toToken, userData]);

  return (
    <div className="flex flex-col max-w-xl w-full gap-4 p-6 border rounded-md">
      <h1 className="text-xl font-bold">Swap</h1>

      <div className="flex flex-col gap-1">
        <span className="font-bold">From</span>
        <select
          className="border-2 border-gray-500 rounded-lg px-4 py-2 text-black"
          value={fromToken}
          onChange={(e) => setFromToken(e.target.value)}
        >
          {uniqueTokens.map((token) => (
            <option key={token} value={token}>
              {token}
            </option>
          ))}
        </select>
       
      <input
        type="number"
        step="any"
        className="border-2 border-gray-500 rounded-lg px-4 py-2 bg-gray-100 text-black"
        placeholder="Amount"
        value={fromAmount}
        onChange={(e) => setFromAmount(Number(e.target.value || 0))}
      />
      <div className="flex items-center gap-2">
        <button
          className="bg-gray-200 hover:bg-gray-300 text-black font-medium py-1 px-2 rounded disabled:bg-gray-300 disabled:cursor-not-allowed"
          disabled={!userData}
          onClick={async () => {
            await handleMint(fromToken, 100_000_000);
            const fb = await readTokenBalance(fromToken);
            setFromBalance(fb);
          }}
        >
          Faucet: Mint From
        </button>
      </div>
      </div>
      <div className="flex flex-col gap-1">
        <span className="font-bold">To</span>
        <select
          className="border-2 border-gray-500 rounded-lg px-4 py-2 text-black"
          value={toToken}
          onChange={(e) => setToToken(e.target.value)}
        >
          {toTokensList.map((token) => (
            <option key={token} value={token}>
              {token}
            </option>
          ))}
        </select>
      <span>Estimated Output: {estimatedToAmount.toString()}</span>
      <div className="flex items-center gap-2">
        <button
          className="bg-gray-200 hover:bg-gray-300 text-black font-medium py-1 px-2 rounded disabled:bg-gray-300 disabled:cursor-not-allowed"
          disabled={!userData}
          onClick={async () => {
            await handleMint(toToken, 100_000_000);
            const tb = await readTokenBalance(toToken);
            setToBalance(tb);
          }}
        >
          Faucet: Mint To
        </button>
      </div>
      </div>

      

      <button
        className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:bg-gray-700 disabled:cursor-not-allowed"
        disabled={!userData || fromAmount <= 0}
        onClick={() => {
          const pool = selectBestPool(fromToken, toToken, pools);
          if (!pool) return;

          const zeroForOne = fromToken === pool["token-0"];
          handleSwap(pool, fromAmount, zeroForOne);
        }}
      >
        Swap
      </button>
    </div>
  );
}
  function selectBestPool(ft: string, tt: string, poolsList: Pool[]): Pool | null {
    const pairPools = poolsList.filter(
      (p) =>
        (p["token-0"] === ft && p["token-1"] === tt) ||
        (p["token-0"] === tt && p["token-1"] === ft)
    );
    if (pairPools.length === 0) return null;
    const withReserves = pairPools.filter((p) => p["balance-0"] > 0 && p["balance-1"] > 0);
    const candidates = withReserves.length > 0 ? withReserves : pairPools;
    // Prefer the highest liquidity/product of reserves
    const sorted = candidates.sort((a, b) => {
      const aProd = (a["balance-0"] || 0) * (a["balance-1"] || 0);
      const bProd = (b["balance-0"] || 0) * (b["balance-1"] || 0);
      if (bProd !== aProd) return bProd - aProd;
      // Tiebreaker: lower fee is better for user
      return a.fee - b.fee;
    });
    return sorted[0] ?? pairPools[0];
  }