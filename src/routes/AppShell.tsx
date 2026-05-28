import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { Calendar, LayoutDashboard, ListChecks, BarChart3, CalendarClock, Waves, Menu, X, Users, Database, LogOut, Languages, Moon, Sun, MessageSquarePlus } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";

const baseNav = [
  { to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard, adminOnly: false },
  { to: "/calendar", labelKey: "nav.calendar", icon: Calendar, adminOnly: false },
  { to: "/bookings", labelKey: "nav.bookings", icon: ListChecks, adminOnly: false },
  { to: "/slots", labelKey: "nav.slots", icon: CalendarClock, adminOnly: false },
  { to: "/reports", labelKey: "nav.reports", icon: BarChart3, adminOnly: false },
  { to: "/import", labelKey: "nav.import", icon: MessageSquarePlus, adminOnly: false },
  { to: "/users", labelKey: "nav.users", icon: Users, adminOnly: true },
  { to: "/backups", labelKey: "nav.backups", icon: Database, adminOnly: true },
] as const;

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { user, fullName, isAdmin, signOut } = useAuth();
  const { t, lang, setLang } = useT();
  const { theme, toggle: toggleTheme } = useTheme();

  const nav = baseNav.filter((n) => !n.adminOnly || isAdmin);
  const initials = (fullName || user?.email || "?").slice(0, 2).toUpperCase();

  return (
    <div className="min-h-screen flex bg-background">
      <aside
        className={cn(
          "fixed inset-y-0 z-40 w-64 bg-sidebar text-sidebar-foreground border-sidebar-border transform transition-transform lg:translate-x-0 lg:static lg:flex-shrink-0",
          lang === "ar" ? "right-0 border-l" : "left-0 border-r",
          open ? "translate-x-0" : (lang === "ar" ? "translate-x-full" : "-translate-x-full")
        )}
      >
        <div className="h-16 flex items-center gap-2 px-6 border-b border-sidebar-border">
          <div className="size-9 rounded-xl bg-primary text-primary-foreground grid place-items-center">
            <Waves className="size-5" />
          </div>
          <div>
            <div className="font-semibold leading-tight">{t("app.title")}</div>
            <div className="text-[11px] text-muted-foreground">{t("app.subtitle")}</div>
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
                {t(n.labelKey as any)}
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
            <div className="text-sm text-muted-foreground">{t("app.header.eyebrow")}</div>
            <div className="text-base font-semibold leading-tight">{t("app.header.title")}</div>
          </div>

          <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme" title={theme === "dark" ? t("action.theme.light") : t("action.theme.dark")}>
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setLang(lang === "ar" ? "en" : "ar")} className="gap-2">
            <Languages className="size-4" />
            <span className="hidden sm:inline">{t("action.language")}</span>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 px-2">
                <div className="size-8 rounded-full bg-primary/15 text-primary grid place-items-center text-xs font-semibold">{initials}</div>
                <div className="text-start hidden sm:block">
                  <div className="text-sm font-medium leading-tight">{fullName || user?.email}</div>
                  <div className="text-[11px] text-muted-foreground">{isAdmin ? t("role.admin") : t("role.staff")}</div>
                </div>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <div className="font-medium">{fullName || "Account"}</div>
                <div className="text-xs text-muted-foreground font-normal">{user?.email}</div>
                <Badge variant="secondary" className="mt-1">{isAdmin ? t("role.admin") : t("role.staff")}</Badge>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={async () => { await signOut(); navigate({ to: "/login" }); }}>
                <LogOut className="size-4 me-2" /> {t("action.signOut")}
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
