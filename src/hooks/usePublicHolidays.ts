import { useState, useEffect } from "react";

export interface Holiday {
  date: string;
  localName: string;
  name: string;
}

export const usePublicHolidays = (year: number) => {
  const [holidays, setHolidays] = useState<Record<string, Holiday>>({});

  useEffect(() => {
    const key = `bh_holidays_${year}`;
    try {
      const cached = localStorage.getItem(key);
      if (cached) {
        setHolidays(JSON.parse(cached));
        return;
      }
    } catch {}

    fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/BH`)
      .then((r) => r.json())
      .then((data: Holiday[]) => {
        const map: Record<string, Holiday> = {};
        data.forEach((h) => {
          map[h.date] = h;
        });
        setHolidays(map);
        try {
          localStorage.setItem(key, JSON.stringify(map));
        } catch {}
      })
      .catch(() => {});
  }, [year]);

  return holidays;
};
