import { Pool } from "@/lib/amm";
import Link from "next/link";

export interface PoolsListProps {
  pools: Pool[];
}

export function PoolsList({ pools }: PoolsListProps) {
  if (pools.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="text-gray-400 text-center">
          <p className="text-lg font-semibold mb-2">No pools found</p>
          <p>Pools will appear here once they are created on-chain.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-2 md:grid-cols-4 place-items-center w-full bg-gray-900 justify-between p-2 md:p-4 font-semibold gap-2">
        <span className="truncate">ID</span>
        <span className="truncate">Token Pair</span>
        <span className="hidden md:block">Fee</span>
        <span className="hidden md:block">Liquidity</span>
      </div>
      {pools.map((pool) => (
        <PoolListItem
          key={`pool-${pool["token-0"]}-${pool["token-1"]}`}
          pool={pool}
        />
      ))}
    </div>
  );
}

export function PoolListItem({ pool }: { pool: Pool }) {
  const token0Name = pool["token-0"].split(".")[1];
  const token1Name = pool["token-1"].split(".")[1];
  const feesInPercentage = pool.fee / 10_000;
  const poolIdHex = formatPoolId(pool.id);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 place-items-center w-full bg-gray-800 justify-between p-2 md:p-4 gap-2">
      <div className="min-w-0 w-full overflow-x-auto whitespace-nowrap" title={poolIdHex}>
        <span className="inline-block">{poolIdHex}</span>
      </div>
      <div className="min-w-0 w-full overflow-x-auto whitespace-nowrap flex items-center gap-1">
        <Link
          href={`https://explorer.hiro.so/txid/${pool["token-0"]}?chain=testnet`}
          target="_blank"
        >
          {token0Name}
        </Link>
        <span>/</span>
        <Link
          href={`https://explorer.hiro.so/txid/${pool["token-1"]}?chain=testnet`}
          target="_blank"
        >
          {token1Name}
        </Link>
      </div>
      <span className="hidden md:block">{feesInPercentage}%</span>
      <div className="hidden md:flex items-center gap-2">
        {pool["balance-0"]} {token0Name} / {pool["balance-1"]} {token1Name}
      </div>
    </div>
  );
}

function formatPoolId(id: unknown): string {
  if (typeof id === "string") return id;
  try {
    const bytes = id as Uint8Array;
    if (bytes && typeof bytes.length === "number") {
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
  } catch (_) {
    // fall through
  }
  return String(id ?? "");
}