import {
  addLiquidity,
  createPool,
  Pool,
  removeLiquidity,
  swap,
  mintToken,
  getTokenBalance,
} from "@/lib/amm";
import {
  AppConfig,
  openContractCall,
  showConnect,
  type UserData,
  UserSession,
} from "@stacks/connect";
import { PostConditionMode } from "@stacks/transactions";
import { useEffect, useState } from "react";

const appDetails = {
  name: "Full Range AMM",
  icon: "https://cryptologos.cc/logos/stacks-stx-logo.png",
};

export function useStacks() {
  const [userData, setUserData] = useState<UserData | null>(null);

  const appConfig = new AppConfig(["store_write"]);
  const userSession = new UserSession({ appConfig });

  function connectWallet() {
    showConnect({
      appDetails,
      onFinish: () => {
        window.location.reload();
      },
      userSession,
    });
  }

  function disconnectWallet() {
    userSession.signUserOut();
    setUserData(null);
  }

  function getUserAddress(): string | null {
    // Prefer testnet address; fallback to mainnet if needed
    try {
      const addr = (userData as any)?.profile?.stxAddress?.testnet || (userData as any)?.profile?.stxAddress?.mainnet;
      return typeof addr === "string" ? addr : null;
    } catch {
      return null;
    }
  }

  async function handleCreatePool(token0: string, token1: string, fee: number) {
    try {
      if (!userData) throw new Error("User not connected");
      const options = await createPool(token0, token1, fee);
      await openContractCall({
        ...options,
        appDetails,
        onFinish: (data: unknown) => {
          window.alert("Sent create pool transaction");
          console.log(data);
          // Refresh the page to re-fetch server-rendered pools
          setTimeout(() => {
            try {
              window.location.reload();
            } catch {}
          }, 1500);
        },
        postConditionMode: PostConditionMode.Allow,
      });
    } catch (_err) {
      const err = _err as Error;
      console.log(err);
      window.alert(err.message);
      return;
    }
  }

  async function handleSwap(pool: Pool, amount: number, zeroForOne: boolean) {
    try {
      if (!userData) throw new Error("User not connected");
      const options = await swap(pool, amount, zeroForOne);
      await openContractCall({
        ...options,
        appDetails,
        onFinish: (data: unknown) => {
          window.alert("Sent swap transaction");
          console.log(data);
          // Refresh balances/UI
          setTimeout(() => {
            try {
              window.location.reload();
            } catch {}
          }, 1500);
        },
        postConditionMode: PostConditionMode.Allow,
      });
    } catch (_err) {
      const err = _err as Error;
      console.log(err);
      window.alert(err.message);
      return;
    }
  }

  async function handleAddLiquidity(pool: Pool, amount0: number, amount1: number) {
    try {
      if (!userData) throw new Error("User not connected");
      const options = await addLiquidity(pool, amount0, amount1);
      await openContractCall({
        ...options,
        appDetails,
        onFinish: (data: unknown) => {
          window.alert("Sent add liquidity transaction");
          console.log({ data });
          // Refresh pools and balances
          setTimeout(() => {
            try {
              window.location.reload();
            } catch {}
          }, 1500);
        },
        postConditionMode: PostConditionMode.Allow,
      });
    } catch (_err) {
      const err = _err as Error;
      console.log(err);
      window.alert(err.message);
      return;
    }
  }

  async function handleRemoveLiquidity(pool: Pool, liquidity: number) {
    try {
      if (!userData) throw new Error("User not connected");
      const options = await removeLiquidity(pool, liquidity);
      await openContractCall({
        ...options,
        appDetails,
        onFinish: (data: unknown) => {
          window.alert("Sent remove liquidity transaction");
          console.log(data);
          // Refresh pools and balances
          setTimeout(() => {
            try {
              window.location.reload();
            } catch {}
          }, 1500);
        },
        postConditionMode: PostConditionMode.Allow,
      });
    } catch (_err) {
      const err = _err as Error;
      console.log(err);
      window.alert(err.message);
      return;
    }
  }

  // Mint (owner-only on current mock-token contracts)
  async function handleMint(tokenContract: string, amount: number) {
    try {
      if (!userData) throw new Error("User not connected");
      const recipient = getUserAddress();
      if (!recipient) throw new Error("Could not resolve user address");
      const options = await mintToken(tokenContract, amount, recipient);
      await openContractCall({
        ...options,
        appDetails,
        onFinish: (data: unknown) => {
          window.alert("Sent mint transaction");
          console.log(data);
        },
        postConditionMode: PostConditionMode.Allow,
      });
    } catch (_err) {
      const err = _err as Error;
      console.log(err);
      window.alert(err.message);
      return;
    }
  }

  // Read helpers wired through hook for convenience
  async function readTokenBalance(tokenContract: string): Promise<number> {
    const addr = getUserAddress();
    if (!addr) return 0;
    return await getTokenBalance(tokenContract, addr);
  }


  useEffect(() => {
    async function initSession() {
      try {
        if (userSession.isSignInPending()) {
          const data = await userSession.handlePendingSignIn();
          setUserData(data as UserData);
        } else if (userSession.isUserSignedIn()) {
          const data = userSession.loadUserData();
          setUserData(data);
        }
      } catch (error) {
        console.error("Error handling user session:", error);
      }
    }

    initSession();
  }, []);

  // ✅ Return everything you need outside this hook
  return {
    userData,
    connectWallet,
    disconnectWallet,
    handleCreatePool,
    handleSwap,
    handleAddLiquidity,
    handleRemoveLiquidity,
    handleMint,
    readTokenBalance,
  };
}
