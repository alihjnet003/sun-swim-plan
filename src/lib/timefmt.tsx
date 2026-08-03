import { createContext, useContext, useState, type ReactNode } from "react";
import { getTimeFormat, setTimeFormatValue, type TimeFormat } from "@/lib/format";

interface Ctx {
  timeFormat: TimeFormat;
  setTimeFormat: (f: TimeFormat) => void;
  toggleTimeFormat: () => void;
}

const TimeFmtCtx = createContext<Ctx | null>(null);

export function TimeFormatProvider({ children }: { children: ReactNode }) {
  const [timeFormat, setState] = useState<TimeFormat>(() => getTimeFormat());

  const setTimeFormat = (f: TimeFormat) => {
    setTimeFormatValue(f);
    setState(f);
  };

  return (
    <TimeFmtCtx.Provider
      value={{
        timeFormat,
        setTimeFormat,
        toggleTimeFormat: () => setTimeFormat(timeFormat === "12" ? "24" : "12"),
      }}
    >
      {children}
    </TimeFmtCtx.Provider>
  );
}

export function useTimeFormat() {
  const ctx = useContext(TimeFmtCtx);
  if (!ctx) throw new Error("useTimeFormat must be inside TimeFormatProvider");
  return ctx;
}
