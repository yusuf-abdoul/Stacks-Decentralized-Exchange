import { AddLiquidity } from "@/components/add-liquidity";
import { CreatePool } from "@/components/create-pool";
import { PoolsList } from "@/components/pools";
import { RemoveLiquidity } from "@/components/remove-liquidity";
import { getAllPools, Pool } from "@/lib/amm";

export const dynamic = "force-dynamic";

export default async function Pools() {
  let allPools: Pool[] = [];
  let error: string | null = null;

  try {
    allPools = await getAllPools();
  } catch (err) {
    console.error("Error fetching pools:", err);
    error = err instanceof Error ? err.message : "Failed to fetch pools";
  }

  return (
    <main className="flex min-h-screen flex-col gap-8 p-4 md:p-24">
      <h1 className="text-3xl font-bold">Pools</h1>

      {error ? (
        <div className="bg-red-900 border border-red-700 text-red-100 px-4 py-3 rounded">
          <p className="font-bold">Error loading pools:</p>
          <p>{error}</p>
          <p className="text-sm mt-2">Check the browser console for more details.</p>
        </div>
      ) : (
        <>
          <PoolsList pools={allPools} />
          {allPools.length === 0 && (
            <div className="bg-yellow-900 border border-yellow-700 text-yellow-100 px-4 py-3 rounded">
              <p className="font-bold">No pools found</p>
              <p>Create a pool to get started, or check if pools exist on-chain.</p>
            </div>
          )}
        </>
      )}

      <hr />
      <div className="flex justify-center gap-8 flex-col md:flex-row">
        <CreatePool />
        {allPools.length > 0 ? (
          <>
            <AddLiquidity pools={allPools} />
            <RemoveLiquidity pools={allPools} />
          </>
        ) : null}
      </div>
    </main>
  );
}