import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { queryClient, trpcClient, TRPCProvider } from "./net/trpc";
import "@fontsource/golos-text/400.css";
import "@fontsource/golos-text/500.css";
import "@fontsource/golos-text/600.css";
import "@fontsource/golos-text/700.css";
import "@fontsource/tiny5/400.css";
import "./theme.css";
import { applyLocale, currentLocale } from "./i18n";

applyLocale(currentLocale());

const AdminApp = lazy(() => import("./admin/AdminApp"));
// Dead code in production builds: Vite replaces import.meta.env.DEV with false and drops the chunk.
const KitPreview = import.meta.env.DEV ? lazy(() => import("./kit-preview/KitPreview")) : null;
const isAdminPage = window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/");
// Dev-only component gallery.
const isKitPage = import.meta.env.DEV && window.location.pathname === "/kit";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        {isKitPage && KitPreview ? (
          <Suspense fallback={null}>
            <KitPreview />
          </Suspense>
        ) : isAdminPage ? (
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
