"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { HAS_ADDRESS_COOKIE } from "@/lib/address-cookie";

const STORAGE_KEY = "govroll_address";
const CHANGE_EVENT = "govroll_address_change";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

function getSnapshot(): string {
  return localStorage.getItem(STORAGE_KEY) ?? "";
}

function getServerSnapshot(): string {
  return "";
}

function getLoadedSnapshot(): boolean {
  return true;
}

function getLoadedServerSnapshot(): boolean {
  return false;
}

function writeFlagCookie(hasAddress: boolean) {
  if (hasAddress) {
    document.cookie = `${HAS_ADDRESS_COOKIE}=1; path=/; max-age=31536000; SameSite=Lax`;
  } else {
    document.cookie = `${HAS_ADDRESS_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  }
}

export function useAddress() {
  const address = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );
  const isLoaded = useSyncExternalStore(
    subscribe,
    getLoadedSnapshot,
    getLoadedServerSnapshot,
  );

  // Keep the flag cookie in sync with localStorage — also repairs the
  // cookie for users who set their address before this was introduced.
  useEffect(() => {
    if (!isLoaded) return;
    writeFlagCookie(!!address);
  }, [address, isLoaded]);

  const setUserAddress = useCallback((newAddress: string) => {
    if (newAddress) {
      localStorage.setItem(STORAGE_KEY, newAddress);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    writeFlagCookie(!!newAddress);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return { address, setUserAddress, isLoaded };
}
