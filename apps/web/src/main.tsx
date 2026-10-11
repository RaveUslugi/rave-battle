import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { queryClient, trpcClient, TRPCProvider } from "./net/trpc";
import "./theme.css";

const AdminApp = lazy(() => import("./admin/AdminApp"));
const isAdminPage = window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {isAdminPage ? (
          <Suspense fallback={null}>
            <AdminApp />
          </Suspense>
        ) : (
          <App />
        )}
      </TRPCProvider>
    </QueryClientProvider>
  </StrictMode>,
);
