import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { Calendar, LayoutDashboard, ListChecks, BarChart3, CalendarClock, Waves, Menu, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/calendar", label: "Monthly Calendar", icon: Calendar },
  { to: "/bookings", label: "Bookings", icon: ListChecks },
  { to: "/slots", label: "Slot Management", icon: CalendarClock },
  { to: "/reports", label: "Reports", icon: BarChart3 },
];

export function AppShell() {
  const location = useLocation();
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen flex bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-64 bg-sidebar text-sidebar-foreground border-r border-sidebar-border transform transition-transform lg:translate-x-0 lg:static lg:flex-shrink-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="h-16 flex items-center gap-2 px-6 border-b border-sidebar-border">
          <div className="size-9 rounded-xl bg-primary text-primary-foreground grid place-items-center">
            <Waves className="size-5" />
          </div>
          <div>
            <div className="font-semibold leading-tight">Aqua Admin</div>
            <div className="text-[11px] text-muted-foreground">Pool Booking System</div>
          </div>
        </div>
        <nav className="p-3 space-y-1">
          {nav.map((n) => {
            const active = location.pathname === n.to || (n.to !== "/" && location.pathname.startsWith(n.to));
            const Icon = n.icon;
            return (
              <Link
                key={n.to}
                to={n.to}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-sidebar-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <Icon className="size-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="absolute bottom-4 left-4 right-4 text-[11px] text-muted-foreground">
          Admin demo · v1.0
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={() => setOpen(false)} />
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Topbar */}
        <header className="h-16 border-b bg-card/50 backdrop-blur sticky top-0 z-20 flex items-center px-4 lg:px-8 gap-3">
          <button
            className="lg:hidden p-2 rounded-md hover:bg-accent"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <div className="flex-1">
            <div className="text-sm text-muted-foreground">Swimming Pool</div>
            <div className="text-base font-semibold leading-tight">Booking Management</div>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-8 max-w-[1400px] w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
