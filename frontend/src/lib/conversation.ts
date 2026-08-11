import type { SupabaseClient } from "@supabase/supabase-js";
import type { LearnerLevelId, TargetLanguage } from "@/lib/learner";

export type CorrectionSeverity = "minor" | "important" | "blocking";

export type TutorCorrection = {
  original: string;
  corrected: string;
  explanation_pt_br: string;
  severity: CorrectionSeverity;
};

export type ConversationMessage = {
  sequence: number;
  role: "tutor" | "learner";
  content: string;
  correction?: TutorCorrection | null;
};

export type ConversationSession = {
  session_id: string;
  scenario_id: string;
  target_language: TargetLanguage;
  learner_level: Exclude<LearnerLevelId, "C1">;
  planned_minutes: number;
  started_at: string;
  resumed: boolean;
  learner_message_count: number;
  max_learner_messages: number;
  messages: ConversationMessage[];
};

export type TutorReply = {
  reply: string;
  correction: TutorCorrection | null;
  should_retry: boolean;
};

export type SendMessageResult = {
  request_id: string;
  learner_sequence: number;
  tutor_sequence: number;
  result: TutorReply;
  learner_message_count: number;
  max_learner_messages: number;
};

export type FocusArea = { title_pt_br: string; detail_pt_br: string };
export type VocabularyItem = { term: string; translation_pt_br: string };

export type SessionSummary = {
  headline_pt_br: string;
  encouragement_pt_br: string;
  strengths_pt_br: string[];
  focus_areas: FocusArea[];
  vocabulary: VocabularyItem[];
  objective_progress: number;
};

export type CompletedConversation = {
  session_id: string;
  summary: SessionSummary;
};

export type SpeechTranscription = {
  request_id: string;
  transcript: string;
};

export type ScenarioCatalogItem = {
  id: string;
  category: "daily" | "professional" | "travel";
  title: string;
  description: string;
  objective: string;
  minLevel: string;
  maxLevel: string;
  plannedMinutes: number;
  icon: string;
  accent: string;
  goals: string[];
};

type ScenarioRow = {
  id: string;
  category: ScenarioCatalogItem["category"];
  title_pt_br: string;
  description_pt_br: string;
  objective_pt_br: string;
  min_level: string;
  max_level: string;
  planned_minutes: number;
  icon: string;
  accent: string;
  goals_pt_br: string[];
};

export type SessionHistoryEntry = {
  sessionId: string;
  scenarioId: string;
  targetLanguage: TargetLanguage;
  status: "active" | "completed" | "abandoned";
  startedAt: string;
  endedAt: string | null;
  learnerMessageCount: number;
  correctionCount: number;
  summary: SessionSummary | null;
  messages: ConversationMessage[];
};

export class ConversationApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ConversationApiError";
    this.status = status;
  }
}

const apiBaseUrl = () => process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") || "";

async function request<T>(
  path: string,
  {
    accessToken,
    method = "POST",
    body,
    signal,
  }: {
    accessToken: string;
    method?: "GET" | "POST" | "DELETE";
    body?: unknown;
    signal?: AbortSignal;
  },
): Promise<T> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) {
    throw new ConversationApiError("A URL do backend ainda não foi configurada.", 0);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof payload?.detail === "string" ? payload.detail : null;
    throw new ConversationApiError(
      detail || "Não foi possível falar com o tutor agora.",
      response.status,
    );
  }
  return payload as T;
}

export async function transcribeAudio(
  accessToken: string,
  audio: Blob,
  targetLanguage: TargetLanguage,
  signal?: AbortSignal,
): Promise<SpeechTranscription> {
  const baseUrl = apiBaseUrl();
  if (!baseUrl) {
    throw new ConversationApiError("A URL do backend ainda não foi configurada.", 0);
  }
  const requestId = crypto.randomUUID();
  const response = await fetch(
    `${baseUrl}/api/v1/speech/transcribe?language=${encodeURIComponent(targetLanguage)}&request_id=${requestId}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": audio.type || "audio/webm",
      },
      body: audio,
      signal,
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof payload?.detail === "string" ? payload.detail : null;
    throw new ConversationApiError(
      detail || "Não foi possível transcrever o áudio agora.",
      response.status,
    );
  }
  return payload as SpeechTranscription;
}

export function startConversation(
  accessToken: string,
  input: {
    scenarioId: string;
    targetLanguage: TargetLanguage;
    learnerLevel: Exclude<LearnerLevelId, "C1">;
  },
  signal?: AbortSignal,
) {
  return request<ConversationSession>("/api/v1/conversations", {
    accessToken,
    body: {
      scenario_id: input.scenarioId,
      target_language: input.targetLanguage,
      learner_level: input.learnerLevel,
    },
    signal,
  });
}

export function readConversation(accessToken: string, sessionId: string, signal?: AbortSignal) {
  return request<ConversationSession>(`/api/v1/conversations/${sessionId}`, {
    accessToken,
    method: "GET",
    signal,
  });
}

export function sendConversationMessage(
  accessToken: string,
  sessionId: string,
  input: { message: string; requestId: string },
  signal?: AbortSignal,
) {
  return request<SendMessageResult>(`/api/v1/conversations/${sessionId}/messages`, {
    accessToken,
    body: { message: input.message, request_id: input.requestId },
    signal,
  });
}

export function translateConversationMessage(
  accessToken: string,
  sessionId: string,
  messageSequence: number,
) {
  return request<{ message_sequence: number; translation_pt_br: string }>(
    `/api/v1/conversations/${sessionId}/translations`,
    {
      accessToken,
      body: { message_sequence: messageSequence, request_id: crypto.randomUUID() },
    },
  );
}

export function completeConversation(accessToken: string, sessionId: string) {
  return request<CompletedConversation>(`/api/v1/conversations/${sessionId}/complete`, {
    accessToken,
  });
}

export function abandonConversation(accessToken: string, sessionId: string) {
  return request<void>(`/api/v1/conversations/${sessionId}/abandon`, { accessToken });
}

export function cancelConversationGeneration(
  accessToken: string,
  sessionId: string,
  requestId: string,
) {
  return request<{ cancelled: boolean }>(
    `/api/v1/conversations/${sessionId}/generations/${requestId}`,
    { accessToken, method: "DELETE" },
  );
}

export async function loadScenarioCatalog(
  supabase: SupabaseClient,
): Promise<ScenarioCatalogItem[]> {
  const { data, error } = await supabase
    .from("conversation_scenarios")
    .select(
      "id,category,title_pt_br,description_pt_br,objective_pt_br,min_level,max_level," +
        "planned_minutes,icon,accent,goals_pt_br",
    )
    .eq("is_published", true)
    .order("sort_order");
  if (error) throw error;
  return ((data || []) as unknown as ScenarioRow[]).map((row) => ({
    id: row.id,
    category: row.category as ScenarioCatalogItem["category"],
    title: row.title_pt_br,
    description: row.description_pt_br,
    objective: row.objective_pt_br,
    minLevel: row.min_level,
    maxLevel: row.max_level,
    plannedMinutes: row.planned_minutes,
    icon: row.icon,
    accent: row.accent,
    goals: (row.goals_pt_br as string[]) || [],
  }));
}

type SessionRow = {
  id: string;
  scenario_id: string;
  target_language: TargetLanguage;
  status: SessionHistoryEntry["status"];
  started_at: string;
  ended_at: string | null;
  learner_message_count: number;
  correction_count: number;
};

type SummaryRow = {
  session_id: string;
  headline_pt_br: string;
  encouragement_pt_br: string;
  strengths_pt_br: string[];
  focus_areas: FocusArea[];
  vocabulary: VocabularyItem[];
  objective_progress: number;
};

type MessageRow = {
  session_id: string;
  sequence: number;
  role: ConversationMessage["role"];
  content: string;
  correction: TutorCorrection | null;
};

export async function loadSessionHistory(
  supabase: SupabaseClient,
  userId: string,
  limit = 20,
): Promise<SessionHistoryEntry[]> {
  const sessionsResult = await supabase
    .from("conversation_sessions")
    .select(
      "id,scenario_id,target_language,status,started_at,ended_at," +
        "learner_message_count,correction_count",
    )
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (sessionsResult.error) throw sessionsResult.error;
  const sessionRows = (sessionsResult.data || []) as unknown as SessionRow[];
  if (!sessionRows.length) return [];
  const sessionIds = sessionRows.map(({ id }) => id);

  const [summariesResult, messagesResult] = await Promise.all([
    supabase
      .from("session_summaries")
      .select(
        "session_id,headline_pt_br,encouragement_pt_br,strengths_pt_br," +
          "focus_areas,vocabulary,objective_progress",
      )
      .eq("user_id", userId)
      .in("session_id", sessionIds),
    supabase
      .from("conversation_messages")
      .select("session_id,sequence,role,content,correction")
      .eq("user_id", userId)
      .in("session_id", sessionIds)
      .order("sequence"),
  ]);

  if (summariesResult.error) throw summariesResult.error;
  if (messagesResult.error) throw messagesResult.error;

  const summaries = new Map(
    ((summariesResult.data || []) as unknown as SummaryRow[]).map((row) => [
      row.session_id,
      {
        headline_pt_br: row.headline_pt_br,
        encouragement_pt_br: row.encouragement_pt_br,
        strengths_pt_br: row.strengths_pt_br,
        focus_areas: row.focus_areas,
        vocabulary: row.vocabulary,
        objective_progress: row.objective_progress,
      } satisfies SessionSummary,
    ]),
  );

  const messagesBySession = new Map<string, ConversationMessage[]>();
  for (const row of (messagesResult.data || []) as unknown as MessageRow[]) {
    const messages = messagesBySession.get(row.session_id) || [];
    messages.push({
      sequence: row.sequence,
      role: row.role,
      content: row.content,
      correction: row.correction,
    });
    messagesBySession.set(row.session_id, messages);
  }

  return sessionRows.map((row) => ({
    sessionId: row.id,
    scenarioId: row.scenario_id,
    targetLanguage: row.target_language,
    status: row.status,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    learnerMessageCount: row.learner_message_count,
    correctionCount: row.correction_count,
    summary: summaries.get(row.id) || null,
    messages: messagesBySession.get(row.id) || [],
  }));
}

const levelOrder = ["A1", "A2", "B1", "B2"];

/**
 * Cenário sugerido: o primeiro publicado cuja faixa de nível cobre o aluno.
 * Sem correspondência, devolve o primeiro do catálogo em vez de nada.
 */
export function recommendScenario(
  scenarios: ScenarioCatalogItem[],
  learnerLevel: string,
): ScenarioCatalogItem | null {
  if (!scenarios.length) return null;
  const index = levelOrder.indexOf(learnerLevel === "C1" ? "B2" : learnerLevel);
  if (index < 0) return scenarios[0];
  const match = scenarios.find(
    (scenario) =>
      levelOrder.indexOf(scenario.minLevel) <= index &&
      index <= levelOrder.indexOf(scenario.maxLevel),
  );
  return match || scenarios[0];
}

/** Formata segundos como mm:ss, o formato que o cronômetro da conversa exibe. */
export function formatElapsed(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Progresso da sessão a partir do que realmente aconteceu: quantas mensagens o
 * aluno enviou em relação ao ritmo esperado para o tempo planejado. Uma troca a
 * cada 45 segundos é o ritmo usado como referência.
 */
export function sessionProgressPercent(
  learnerMessageCount: number,
  plannedMinutes: number,
  maxLearnerMessages: number,
) {
  const expectedExchanges = Math.max(
    1,
    Math.min(maxLearnerMessages, Math.round((plannedMinutes * 60) / 45)),
  );
  return Math.min(100, Math.round((learnerMessageCount / expectedExchanges) * 100));
}
