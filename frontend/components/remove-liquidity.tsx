"use client";

import { useStacks } from "@/hooks/use-stacks";
import { getUserLiquidity, Pool } from "@/lib/amm";
import { useEffect, useState } from "react";

export interface RemoveLiquidityProps {
  pools: Pool[];
}

export function RemoveLiquidity({ pools }: RemoveLiquidityProps) {
  const { userData, handleRemoveLiquidity } = useStacks();
  const [selectedPool, setSelectedPool] = useState<Pool>(pools[0]);
  const [liquidity, setLiquidity] = useState(0);
  const [userTotalLiquidity, setUserTotalLiquidity] = useState(0);
  const [disabledReason, setDisabledReason] = useState<string | null>(null);

  async function fetchUserLiquidity() {
    const stxAddress = userData?.profile.stxAddress.testnet;
    if (!stxAddress) return;

    getUserLiquidity(selectedPool, stxAddress).then((liquidity) => {
      setUserTotalLiquidity(liquidity);
    });
  }

  useEffect(() => {
    fetchUserLiquidity();
  }, [selectedPool, userData]);

  return (
    <div className="flex flex-col max-w-md w-full gap-4 p-6 border border-gray-500 rounded-md">
      <h1 className="text-xl font-bold">Remove Liquidity</h1>
      <div className="flex flex-col gap-1">
        <span className="font-bold">Pool ID</span>
        <select
          className="border-2 border-gray-500 rounded-lg px-4 py-2 bg-gray-100 text-black"
          value={selectedPool.id}
          onChange={(e) => {
            const poolId = e.target.value;
            setSelectedPool(pools.find((pool) => pool.id === poolId)!);
          }}
        >
          {pools.map((pool) => (
            <option key={pool.id} value={pool.id}>
              {pool.id}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="font-bold">Liquidity</span>
          <span>Max: {userTotalLiquidity}</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            step="1"
            min={0}
            className="border-2 border-gray-500 rounded-lg px-4 py-2 bg-gray-100 text-black flex-1"
            value={liquidity}
            onChange={(e) => {
              const val = Math.max(0, Math.floor(Number(e.target.value || 0)));
              setLiquidity(val);
              if (!userData) setDisabledReason("Connect wallet to remove liquidity");
              else if (val === 0) setDisabledReason("Enter a positive liquidity amount");
              else if (val > userTotalLiquidity) setDisabledReason("Amount exceeds your position");
              else setDisabledReason(null);
            }}
          />
          <button
            className="bg-gray-200 hover:bg-gray-300 text-black font-medium py-1 px-2 rounded disabled:bg-gray-300 disabled:cursor-not-allowed"
            disabled={userTotalLiquidity === 0}
            onClick={() => {
              setLiquidity(userTotalLiquidity);
              setDisabledReason(null);
            }}
          >
            Max
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span>
          Withdraw {selectedPool["token-0"].split(".")[1]}:{" "}
          {(liquidity / selectedPool.liquidity) * selectedPool["balance-0"]}
        </span>
        <span>
          Withdraw {selectedPool["token-1"].split(".")[1]}:{" "}
          {(liquidity / selectedPool.liquidity) * selectedPool["balance-1"]}
        </span>
      </div>

      <button
        className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded disabled:bg-gray-700 disabled:cursor-not-allowed"
        disabled={!userData || liquidity <= 0 || liquidity > userTotalLiquidity}
        onClick={() => {
          try {
            handleRemoveLiquidity(selectedPool, liquidity);
          } catch (e) {
            console.warn("Remove liquidity failed", e);
          }
        }}
      >
        Remove Liquidity
      </button>
      {disabledReason ? (
        <span className="text-sm text-red-300">{disabledReason}</span>
      ) : null}
    </div>
  );
}