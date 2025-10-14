import {
  addLiquidity,
  createPool,
  Pool,
  removeLiquidity,
  swap,
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
import { connect } from "http2";

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
  };
}
