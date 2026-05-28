import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "en" | "ar";

const dict = {
  en: {
    "app.title": "Aqua Admin",
    "app.subtitle": "Pool Booking System",
    "app.header.eyebrow": "Swimming Pool",
    "app.header.title": "Booking Management",
    "nav.dashboard": "Dashboard",
    "nav.calendar": "Monthly Calendar",
    "nav.bookings": "Bookings",
    "nav.slots": "Slot Management",
    "nav.reports": "Reports",
    "nav.users": "Users",
    "nav.backups": "Backups",
    "nav.import": "Import from Message",
    "role.admin": "Admin",
    "role.staff": "Staff",
    "action.signOut": "Sign out",
    "action.newBooking": "+ New Booking",
    "action.language": "العربية",
    "action.theme.light": "Light mode",
    "action.theme.dark": "Dark mode",
    "dashboard.title": "Dashboard",
    "dashboard.overview": "Overview for",
    "stat.totalBookings": "Total Bookings",
    "stat.confirmed": "Confirmed",
    "stat.available": "Available Slots",
    "stat.totalPaid": "Total Paid",
    "stat.unpaid": "Unpaid",
    "stat.deposits": "Deposits",
    "dashboard.latest": "Latest bookings",
    "dashboard.viewAll": "View all →",
    "dashboard.empty": "No bookings yet.",
    "dashboard.todayTomorrow": "Today & tomorrow",
    "dashboard.nothing": "Nothing on the schedule.",
    "dashboard.today": "Today",
    "dashboard.tomorrow": "Tomorrow",
    "dashboard.remaining": "Remaining",
    "dashboard.owes": "Owes",
    "slots.title": "Slot Management",
    "slots.subtitle": "Bulk-generate recurring slots across a date range",
    "slots.from": "From",
    "slots.to": "To",
    "slots.days": "Days of week",
    "slots.presets": "Slot presets",
    "slots.addPreset": "+ Add slot time",
    "slots.label": "Label",
    "slots.start": "Start",
    "slots.end": "End",
    "slots.price": "Price (BHD)",
    "slots.remove": "Remove",
    "slots.generate": "Generate slots",
    "slots.closeRange": "Close entire range",
  },
  ar: {
    "app.title": "إدارة المسبح",
    "app.subtitle": "نظام حجز المسبح",
    "app.header.eyebrow": "المسبح",
    "app.header.title": "إدارة الحجوزات",
    "nav.dashboard": "لوحة التحكم",
    "nav.calendar": "التقويم الشهري",
    "nav.bookings": "الحجوزات",
    "nav.slots": "إدارة الأوقات",
    "nav.reports": "التقارير",
    "nav.users": "المستخدمون",
    "nav.backups": "النسخ الاحتياطي",
    "nav.import": "استيراد من رسالة",
    "role.admin": "مدير",
    "role.staff": "موظف",
    "action.signOut": "تسجيل الخروج",
    "action.newBooking": "+ حجز جديد",
    "action.language": "English",
    "action.theme.light": "الوضع الفاتح",
    "action.theme.dark": "الوضع الداكن",
    "dashboard.title": "لوحة التحكم",
    "dashboard.overview": "نظرة عامة لـ",
    "stat.totalBookings": "إجمالي الحجوزات",
    "stat.confirmed": "مؤكدة",
    "stat.available": "أوقات متاحة",
    "stat.totalPaid": "المبلغ المدفوع",
    "stat.unpaid": "غير مدفوع",
    "stat.deposits": "العربون",
    "dashboard.latest": "أحدث الحجوزات",
    "dashboard.viewAll": "عرض الكل ←",
    "dashboard.empty": "لا توجد حجوزات بعد.",
    "dashboard.todayTomorrow": "اليوم وغدًا",
    "dashboard.nothing": "لا يوجد في الجدول.",
    "dashboard.today": "اليوم",
    "dashboard.tomorrow": "غدًا",
    "dashboard.remaining": "المتبقي",
    "dashboard.owes": "مستحق",
    "slots.title": "إدارة الأوقات",
    "slots.subtitle": "إنشاء أوقات متكررة عبر نطاق تاريخ",
    "slots.from": "من",
    "slots.to": "إلى",
    "slots.days": "أيام الأسبوع",
    "slots.presets": "أوقات الفترات",
    "slots.addPreset": "+ إضافة وقت",
    "slots.label": "الاسم",
    "slots.start": "البداية",
    "slots.end": "النهاية",
    "slots.price": "السعر (د.ب)",
    "slots.remove": "حذف",
    "slots.generate": "إنشاء الأوقات",
    "slots.closeRange": "إغلاق كامل النطاق",
  },
} as const;

type Key = keyof (typeof dict)["en"];

interface Ctx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: Key) => string;
  dir: "ltr" | "rtl";
}

const LangCtx = createContext<Ctx | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    if (typeof window === "undefined") return "en";
    return (localStorage.getItem("lang") as Lang) || "en";
  });

  useEffect(() => {
    const dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    localStorage.setItem("lang", lang);
  }, [lang]);

  const value: Ctx = {
    lang,
    setLang: setLangState,
    t: (k) => (dict[lang] as Record<string, string>)[k] ?? (dict.en as Record<string, string>)[k] ?? k,
    dir: lang === "ar" ? "rtl" : "ltr",
  };
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

export function useT() {
  const ctx = useContext(LangCtx);
  if (!ctx) throw new Error("useT must be inside LanguageProvider");
  return ctx;
}
