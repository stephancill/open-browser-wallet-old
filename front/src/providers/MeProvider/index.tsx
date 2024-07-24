"use client";

import { saveUser } from "@/libs/factory";
import { getUser } from "@/libs/factory/getUser";
import { walletConnect } from "@/libs/wallet-connect/service/wallet-connect";
import { getMessageHash, recoverPublicKey } from "@/utils/webauthn";
import { createContext, useContext, useEffect, useState } from "react";
import { Address, bytesToHex, hashMessage, Hex, zeroAddress } from "viem";
import { createCredential, sign } from "webauthn-p256";

export type Me = {
  account: Address;
  keyId: string;
  pubKey: Hex;
};

function useMeHook() {
  const [isLoading, setIsLoading] = useState(false);
  const [me, setMe] = useState<Me | null>();
  const [isReturning, setIsReturning] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  function disconnect() {
    localStorage.removeItem("passkeys4337.me");
    setMe(null);
  }

  async function create(username: string) {
    setIsLoading(true);
    try {
      const credential = await createCredential({ name: username });

      if (!credential) {
        return;
      }
      const user = await saveUser({
        id: credential.id,
        pubKey: credential.publicKey,
      });

      const me = {
        keyId: user.id,
        pubKey: user.pubKey,
        account: user.account,
      };

      if (me === undefined) {
        console.log("error while saving user");
        return;
      }
      localStorage.setItem("passkeys4337.me", JSON.stringify(me));
      localStorage.setItem("passkeys4337.returning", "true");
      walletConnect.smartWalletAddress = me.account;
      setIsReturning(true);
      setMe(me);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }

  async function get() {
    setIsLoading(true);
    try {
      const message1 = hashMessage(
        bytesToHex(Uint8Array.from("random-challenge1", (c) => c.charCodeAt(0))),
      );
      const { signature: signature1, webauthn: webauthn1 } = await sign({ hash: message1 });

      const message2 = hashMessage(
        bytesToHex(Uint8Array.from("random-challenge2", (c) => c.charCodeAt(0))),
      );
      const { signature: signature2, webauthn: webauthn2 } = await sign({
        hash: message2,
      });

      const messageHash1 = await getMessageHash(webauthn1);
      const messageHash2 = await getMessageHash(webauthn2);

      const recoveryResult = recoverPublicKey([
        { messageHash: messageHash1, signatureHex: signature1 },
        { messageHash: messageHash2, signatureHex: signature2 },
      ]);

      if (!recoveryResult) {
        throw new Error("recovery failed");
      }

      const user = await getUser(recoveryResult);

      if (user?.account === undefined || user?.account === zeroAddress) {
        throw new Error("user not found");
      }

      const me = {
        keyId: user.id as Hex,
        pubKey: user.pubKey,
        account: user.account,
      };

      localStorage.setItem("passkeys4337.me", JSON.stringify(me));
      localStorage.setItem("passkeys4337.returning", "true");
      walletConnect.smartWalletAddress = me.account;
      setIsReturning(true);
      setMe(me);
      return me;
    } catch (e) {
      localStorage.removeItem("passkeys4337.returning");
      disconnect();
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const me = localStorage.getItem("passkeys4337.me");
    const returning = localStorage.getItem("passkeys4337.returning");
    if (me) {
      try {
        setMe(JSON.parse(me));
      } catch (e) {
        console.log("error while parsing me");
      }
    }
    if (returning === "true") {
      setIsReturning(true);
    }
    setIsMounted(true);
  }, []);

  return {
    isLoading,
    isMounted,
    me,
    returning: isReturning,
    create,
    get,
    disconnect,
  };
}

type UseMeHook = ReturnType<typeof useMeHook>;
const MeContext = createContext<UseMeHook | null>(null);

export const useMe = (): UseMeHook => {
  const context = useContext(MeContext);
  if (!context) {
    throw new Error("useMeHook must be used within a MeProvider");
  }
  return context;
};

export function MeProvider({ children }: { children: React.ReactNode }) {
  const hook = useMeHook();

  return <MeContext.Provider value={hook}>{children}</MeContext.Provider>;
}
