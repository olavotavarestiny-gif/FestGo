"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { trackMeta } from "@/lib/meta-browser";
export function MetaAnalytics() {
  const path = usePathname();
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (!path || previous.current === path || /^\/(admin|operacoes|bilhete|reserva|confirmar)(\/|$)/.test(path)) return;
    previous.current = path;
    trackMeta("PageView");
    if (path === "/") trackMeta("ViewContent", { content_name: "Brunch Mangais", content_type: "product" });
  }, [path]);
  return null;
}
