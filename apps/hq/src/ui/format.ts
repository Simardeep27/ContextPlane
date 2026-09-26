import { useEffect, useState } from "react";

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function clock(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function relative(iso: string, now: number) {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 5) return "just now";
  const text = abs < 60 ? `${abs}s` : abs < 3600 ? `${Math.round(abs / 60)} min` : `${Math.round(abs / 3600)} h`;
  return seconds >= 0 ? `in ${text}` : `${text} ago`;
}
