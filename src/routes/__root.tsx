import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, createRootRouteWithContext, HeadContent, Scripts, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/components/AppShell";
import { AuthProvider, useAuth } from "@/lib/auth";
import { LanguageProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";

import appCss from "../styles.css?url";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Aqua Admin — Swimming Pool Booking Management" },
      { name: "description", content: "Admin dashboard to manage pool bookings, slots, payments, reminders, and invoices." },
      { property: "og:title", content: "Aqua Admin — Swimming Pool Booking Management" },
      { name: "twitter:title", content: "Aqua Admin — Swimming Pool Booking Management" },
      { property: "og:description", content: "Admin dashboard to manage pool bookings, slots, payments, reminders, and invoices." },
      { name: "twitter:description", content: "Admin dashboard to manage pool bookings, slots, payments, reminders, and invoices." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/9e27a055-3d5a-4346-96da-9a3e5151c3ff/id-preview-f90174dd--b175b541-ff72-4120-a152-620041cf0c82.lovable.app-1779228839713.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/9e27a055-3d5a-4346-96da-9a3e5151c3ff/id-preview-f90174dd--b175b541-ff72-4120-a152-620041cf0c82.lovable.app-1779228839713.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: () => (
    <div className="min-h-screen grid place-items-center bg-background">
      <div className="text-center">
        <h1 className="text-5xl font-bold">404</h1>
        <p className="text-muted-foreground mt-2">Page not found</p>
        <a href="/" className="inline-block mt-4 text-primary underline">Back to dashboard</a>
      </div>
    </div>
  ),
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <LanguageProvider>
          <AuthProvider>
            <AuthGate />
            <Toaster richColors position="top-right" />
          </AuthProvider>
        </LanguageProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function AuthGate() {
  const { session, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const isLogin = location.pathname === "/login";

  useEffect(() => {
    if (loading) return;
    if (!session && !isLogin) navigate({ to: "/login" });
  }, [loading, session, isLogin, navigate]);

  if (loading) {
    return <div className="min-h-screen grid place-items-center text-muted-foreground">Loading…</div>;
  }
  if (isLogin) return <Outlet />;
  if (!session) return null;
  return <AppShell />;
}
