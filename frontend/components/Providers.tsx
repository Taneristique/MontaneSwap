"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, darkTheme, lightTheme } from "@rainbow-me/rainbowkit";
import { WagmiProvider, type State } from "wagmi";
import { ThemeProvider, useTheme } from "next-themes";
import { useState, type ReactNode } from "react";
import { wagmiConfig } from "@/lib/wagmi";
import { useIsClient } from "@/lib/use-is-client";

const dark = darkTheme({
  accentColor: "#F8FAFC",
  accentColorForeground: "#0B0F14",
  borderRadius: "large",
  overlayBlur: "small",
});

const light = lightTheme({
  accentColor: "#0B0F14",
  accentColorForeground: "#F8FAFC",
  borderRadius: "large",
  overlayBlur: "small",
});

function Kit({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  const ready = useIsClient();
  return (
    <RainbowKitProvider
      theme={ready && resolvedTheme === "light" ? light : dark}
      modalSize="compact"
    >
      {children}
    </RainbowKitProvider>
  );
}

export function Providers({
  children,
  initialState,
}: {
  children: ReactNode;
  initialState?: State;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 0,
            gcTime: 60_000,
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
            refetchOnMount: true,
            refetchIntervalInBackground: true,
            networkMode: "always",
            retry: 2,
          },
        },
      }),
  );
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <WagmiProvider config={wagmiConfig} initialState={initialState}>
        <QueryClientProvider client={queryClient}>
          <Kit>{children}</Kit>
        </QueryClientProvider>
      </WagmiProvider>
    </ThemeProvider>
  );
}
