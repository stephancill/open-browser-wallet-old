"use client";

import { smartWallet } from "@/libs/smart-wallet";
import { walletConnect } from "@/libs/wallet-connect/service/wallet-connect";
import { useMe } from "@/providers/MeProvider";
import { SCWKeyManager } from "@/utils/scw-sdk/SCWKeyManager";
import {
  decryptContent,
  encryptContent,
  exportKeyToHexString,
  importKeyFromHexString,
  RPCRequest,
  RPCResponse,
} from "@/utils/scw-sdk/cipher";
import { replacer } from "@/utils/scw-sdk/json";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

const keyManager = new SCWKeyManager();

async function encryptMessage({
  id,
  timestamp,
  content,
}: {
  id: string;
  timestamp: string;
  content: any;
}) {
  const secret = await keyManager.getSharedSecret();

  if (!secret) {
    throw new Error("Shared secret not derived");
  }

  const encrypted = await encryptContent(content, secret);

  return {
    id,
    requestId: id,
    timestamp,
    sender: await exportKeyToHexString("public", await keyManager.getOwnPublicKey()),
    content: {
      encrypted,
    },
  };
}

type Params = {
  callbackUrl: string;
  message: string;
};

export default function Page() {
  const me = useMe();
  const params = useSearchParams();
  const router = useRouter();
  const hasHandledMessage = useRef(false);

  const id = JSON.parse(params.get("id") || "");
  const sender = JSON.parse(params.get("sender") || "");
  const sdkVersion = JSON.parse(params.get("sdkVersion") || "");
  const callbackUrl = JSON.parse(params.get("callbackUrl") || "");
  const timestamp = JSON.parse(params.get("timestamp") || "");
  const content = JSON.parse(params.get("content") || "");

  const [messages, setMessages] = useState<string[]>([]);

  const addMessage = useCallback(
    (message: string) => {
      setMessages((prev) => [...prev, message]);
    },
    [setMessages],
  );

  const handleMessage = useCallback(
    async (
      m: any,
    ): Promise<
      { requestId: string; sender?: string; content: any } | { requestId: string; data: string }
    > => {
      let decrypted: RPCRequest | RPCResponse<unknown> | undefined;
      if (m.content?.encrypted) {
        const secret = await keyManager.getSharedSecret();
        if (!secret) {
          throw new Error("Shared secret not derived");
        }
        decrypted = await decryptContent(m.content.encrypted, secret);
      }

      decrypted && addMessage(JSON.stringify(decrypted, null, 2));

      if (m.event === "selectSignerType") {
        const response = { requestId: m.id, data: "scw" };
        return response;
      } else if (m.content?.handshake?.method === "eth_requestAccounts") {
        const peerPublicKey = await importKeyFromHexString("public", m.sender);
        await keyManager.setPeerPublicKey(peerPublicKey);
        const accountResult = await me.get();

        const chains: Record<number, string> = {};
        if (smartWallet.client.chain) {
          chains[smartWallet.client.chain.id] = smartWallet.client.chain.rpcUrls.default.http[0];
        }

        const message = {
          result: { value: [accountResult?.account] },
          data: {
            chains,
          },
        };

        return encryptMessage({
          id: m.id,
          timestamp: m.timestamp,
          content: message,
        });
      } else if (decrypted && "action" in decrypted) {
        smartWallet.init();
        if (!decrypted.action.params) {
          throw new Error("No params in action");
        }
        const result = await walletConnect.handleRequest({
          method: decrypted.action.method,
          origin: m.origin,
          params: decrypted.action.params as any,
        });

        const message = {
          result: { value: result },
        };

        return encryptMessage({
          id: m.id,
          content: message,
          timestamp: m.timestamp,
        });

        // if (decrypted.action.method !== "eth_sendTransaction") {
        //   // closePopup();
        // }
      }

      throw new Error("Unsupported message");
    },
    [me],
  );

  useEffect(() => {
    if (!callbackUrl || !me.get || hasHandledMessage.current) {
      return;
    }

    const message = {
      id,
      sender,
      sdkVersion,
      timestamp,
      content,
    };

    if ("encrypted" in message.content) {
      const encrypted = message.content.encrypted;
      message.content = {
        encrypted: {
          iv: new Uint8Array(Buffer.from(encrypted.iv, "hex")),
          cipherText: new Uint8Array(Buffer.from(encrypted.cipherText, "hex")),
        },
      };
    }

    hasHandledMessage.current = true;

    handleMessage(message).then((response) => {
      const url = new URL(callbackUrl);

      for (const [key, value] of Object.entries(response)) {
        url.searchParams.set(key, JSON.stringify(value, replacer));
      }

      router.push(url.toString());
    });
  }, [me, callbackUrl]);

  return (
    <div>
      <div>
        {JSON.stringify({
          id,
          sender,
          sdkVersion,
          timestamp,
          content,
        })}
      </div>
      <div>{callbackUrl}</div>
      {messages.map((message, index) => {
        return <div key={index}>{message}</div>;
      })}
      {callbackUrl && <a href={callbackUrl}>Go back</a>}
    </div>
  );
}
