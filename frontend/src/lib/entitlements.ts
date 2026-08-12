import { apiRequest } from "@/lib/api-client";

export type UsageCounter = {
  used: number;
  limit: number;
};

export type EntitlementsSummary = {
  plan_id: string;
  account_status: string;
  max_learner_messages_per_session: number;
  subscription_status: string;
  subscription_started_at: string | null;
  subscription_ends_at: string | null;
  subscription_renews_at: string | null;
  billing_cycle: "monthly" | "annual" | null;
  subscription_source: string;
  can_manage_billing: boolean;
  usage: {
    conversation_sessions: UsageCounter;
    llm_requests: UsageCounter;
    llm_cost_usd: UsageCounter;
    transcriptions: UsageCounter;
    speech_syntheses: UsageCounter;
  };
};

export function isPremiumPlan(planId: string) {
  return planId === "premium";
}

export function planLabel(planId: string) {
  return planId === "premium" ? "Premium" : "Free";
}

const cachedPlanKey = (userId: string) => `lume:confirmed-plan:${userId}`;

export function readCachedPlan(userId: string): string | null {
  if (typeof window === "undefined") return null;
  const planId = window.sessionStorage.getItem(cachedPlanKey(userId));
  return planId === "premium" || planId === "free" ? planId : null;
}

export function cacheConfirmedPlan(userId: string, planId: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(cachedPlanKey(userId), planId === "premium" ? "premium" : "free");
}

export function clearCachedPlan(userId: string) {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(cachedPlanKey(userId));
}

export async function loadEntitlements(accessToken: string) {
  return apiRequest<EntitlementsSummary>("/api/v1/account/entitlements", { accessToken });
}
