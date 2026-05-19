import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { Calendar, LayoutDashboard, ListChecks, BarChart3, CalendarClock, Waves, Menu, X, Users, Database, LogOut } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

const baseNav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, adminOnly: false },
  { to: "/calendar", label: "Monthly Calendar", icon: Calendar, adminOnly: false },
  { to: "/bookings", label: "Bookings", icon: ListChecks, adminOnly: false },
  { to: "/slots", label: "Slot Management", icon: CalendarClock, adminOnly: false },
  { to: "/reports", label: "Reports", icon: BarChart3, adminOnly: false },
  { to: "/users", label: "Users", icon: Users, adminOnly: true },
  { to: "/backups", label: "Backups", icon: Database, adminOnly: true },
];

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { user, fullName, isAdmin, signOut } = useAuth();

  const nav = baseNav.filter((n) => !n.adminOnly || isAdmin);
  const initials = (fullName || user?.email || "?").slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen flex bg-background">
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
                  active ? "bg-primary text-primary-foreground shadow-sm" : "text-sidebar-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <Icon className="size-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {open && <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 border-b bg-card/50 backdrop-blur sticky top-0 z-20 flex items-center px-4 lg:px-8 gap-3">
          <button className="lg:hidden p-2 rounded-md hover:bg-accent" onClick={() => setOpen((v) => !v)} aria-label="Toggle menu">
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <div className="flex-1">
            <div className="text-sm text-muted-foreground">Swimming Pool</div>
            <div className="text-base font-semibold leading-tight">Booking Management</div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 px-2">
                <div className="size-8 rounded-full bg-primary/15 text-primary grid place-items-center text-xs font-semibold">{initials}</div>
                <div className="text-left hidden sm:block">
                  <div className="text-sm font-medium leading-tight">{fullName || user?.email}</div>
                  <div className="text-[11px] text-muted-foreground">{isAdmin ? "Admin" : "Staff"}</div>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="font-medium">{fullName || "Account"}</div>
                <div className="text-xs text-muted-foreground font-normal">{user?.email}</div>
                <Badge variant="secondary" className="mt-1">{isAdmin ? "Admin" : "Staff"}</Badge>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={async () => { await signOut(); navigate({ to: "/login" }); }}>
                <LogOut className="size-4 mr-2" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="flex-1 p-4 lg:p-8 max-w-[1400px] w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
