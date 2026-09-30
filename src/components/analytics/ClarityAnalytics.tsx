"use client";

import { useEffect } from "react";
import { initializeClarity } from "@/lib/clarity";

const projectId = process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID;

export function ClarityAnalytics() {
  useEffect(() => {
    initializeClarity(projectId);
  }, []);

  return null;
}
