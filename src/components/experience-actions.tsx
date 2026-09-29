"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

const campaignKeys = [
  "source",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
];

function track(name: string, detail: Record<string, string> = {}) {
  window.dispatchEvent(new CustomEvent("festgo:analytics", { detail: { name, ...detail } }));
  const analyticsWindow = window as Window & { dataLayer?: Array<Record<string, string>> };
  analyticsWindow.dataLayer?.push({ event: name, ...detail });
}

export function CampaignLink({
  children,
  className,
  eventName,
}: {
  children: ReactNode;
  className: string;
  eventName: string;
}) {
  const [href, setHref] = useState("/reservar");

  useEffect(() => {
    const current = new URLSearchParams(window.location.search);
    const campaign = new URLSearchParams();
    for (const key of campaignKeys) {
      const value = current.get(key);
      if (value) campaign.set(key, value);
    }
    const query = campaign.toString();
    if (query) setHref(`/reservar?${query}`);
  }, []);

  return (
    <Link href={href} className={className} onClick={() => track(eventName)}>
      {children}
    </Link>
  );
}

export function ExperienceAnalytics() {
  useEffect(() => {
    track("landing_view");
    const services = document.querySelector("#servicos");
    if (!services) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        track("services_view");
        observer.disconnect();
      },
      { threshold: 0.25 },
    );
    observer.observe(services);
    return () => observer.disconnect();
  }, []);
  return null;
}
