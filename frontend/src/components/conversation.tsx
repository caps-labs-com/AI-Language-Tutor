"use client";

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Languages,
  LoaderCircle,
  Mic2,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ProgressRing } from "@/components/ui";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { SpeechPlayback } from "@/components/speech-playback";
import { UPGRADE_HIGHLIGHTS } from "@/lib/pricing";
import { renderScenarioIcon } from "@/components/scenario-icons";
import {
  abandonConversation,
  cancelConversationGeneration,
  ConversationApiError,
  completeConversation,
  formatElapsed,
  readConversation,
  sendConversationMessage,
  sessionProgressPercent,
  startConversation,
  transcribeAudio,
  type ConversationMessage,
  type ConversationSession,
  type ScenarioCatalogItem,
  type SessionSummary,
} from "@/lib/conversation";
import { shortLevel, tutorLevel, type LearnerPreferences, type TargetLanguage } from "@/lib/learner";
import { isPremiumPlan } from "@/lib/entitlements";
import { getSupabaseBrowserClient } from "@/lib/supabase";

export type CompletedConversationView = {
  sessionId: string;
  scenario: ScenarioCatalogItem;
  targetLanguage: TargetLanguage;
  summary: SessionSummary;
  elapsedSeconds: number;
  messageCount: number;
  learnerMessageCount: number;
  correctionCount: number;
};

const severityLabels: Record<string, string> = {
  minor: "Um ajuste pequeno",
  important: "Vale tentar de novo",
  blocking: "Precisa reformular",
};
const VOICE_POLICY_VERSION = "2026-07-31-voice-v1";
const conversationStarters: Record<string, string[]> = {
  en: ["I would like...", "In my experience...", "Could you tell me more about...?"],
  es: ["Me gustaría...", "En mi experiencia...", "¿Podría contarme más sobre...?"],
  fr: ["Je voudrais...", "D'après mon expérience...", "Pourriez-vous m'en dire plus sur... ?"],
  it: ["Vorrei...", "Nella mia esperienza...", "Potrebbe dirmi di più su...?"],
};

export function Conversation({
  scenario,
  preferences,
  session,
  goBack,
  onCompleted,
  onUpgrade,
  planId = "free",
}: {
  scenario: ScenarioCatalogItem;
  preferences: LearnerPreferences | null;
  session: Session | null;
  goBack: () => void;
  onCompleted: (completed: CompletedConversationView) => void;
  onUpgrade?: () => void;
  planId?: string;
}) {
  const accessToken = session?.access_token || "";
  const targetLanguage = preferences?.targetLanguage || "en";
  const learnerLevel = tutorLevel(preferences?.currentLevel);

  const [conversation, setConversation] = useState<ConversationSession | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [startupError, setStartupError] = useState(
    accessToken ? "" : "Sua sessão expirou. Entre novamente para conversar.",
  );
  const [answer, setAnswer] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [retryText, setRetryText] = useState("");
  const [retryRequestId, setRetryRequestId] = useState("");
  const [ending, setEnding] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speechError, setSpeechError] = useState("");
  const [voiceConsent, setVoiceConsent] = useState(false);
  const [showVoiceConsent, setShowVoiceConsent] = useState(false);
  const [savingVoiceConsent, setSavingVoiceConsent] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [hintIndex, setHintIndex] = useState(0);
  const [continuedAfterGoal, setContinuedAfterGoal] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const generationRequestRef = useRef<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const pressingMicRef = useRef(false);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) window.clearTimeout(recordingTimerRef.current);
      if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session?.user.id) return;
    let active = true;
    void supabase
      .from("profiles")
      .select("voice_processing_policy_version")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (active) {
          setVoiceConsent(data?.voice_processing_policy_version === VOICE_POLICY_VERSION);
        }
      });
    return () => {
      active = false;
    };
  }, [session?.user.id]);

  const acceptVoiceConsent = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setSpeechError("Não foi possível registrar sua autorização agora.");
      return;
    }
    setSavingVoiceConsent(true);
    const { error } = await supabase.rpc("record_voice_processing_consent", {
      p_policy_version: VOICE_POLICY_VERSION,
    });
    setSavingVoiceConsent(false);
    if (error) {
      const migrationMissing =
        error.code === "PGRST202" || error.code === "42883" || error.code === "42501";
      setSpeechError(
        migrationMissing
          ? "A correção de autorização de voz ainda não foi aplicada ao banco de dados."
          : "Não foi possível registrar sua autorização. Atualize a página e tente novamente.",
      );
      return;
    }
    setVoiceConsent(true);
    setShowVoiceConsent(false);
    setSpeechError("");
  };

  // `start_conversation_session` retoma uma sessão ativa do mesmo cenário e
  // idioma, então abrir a tela de novo continua a conversa em vez de gastar
  // outra das três sessões diárias.
  useEffect(() => {
    if (!accessToken) {
      return;
    }
    const controller = new AbortController();
    let active = true;
    const begin = async () => {
      setStartupError("");
      try {
        const started = await startConversation(
          accessToken,
          { scenarioId: scenario.id, targetLanguage, learnerLevel },
          controller.signal,
        );
        if (!active) return;
        setConversation(started);
        setMessages(started.messages);
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        setStartupError(
          error instanceof ConversationApiError
            ? error.message
            : "Não foi possível abrir a conversa agora.",
        );
      }
    };
    void begin();
    return () => {
      active = false;
      controller.abort();
    };
  }, [accessToken, learnerLevel, scenario.id, targetLanguage]);

  // O cronômetro parte de `started_at` gravado no banco, então recarregar a
  // página não zera o tempo da sessão.
  useEffect(() => {
    if (!conversation) return;
    const startedAt = Date.parse(conversation.started_at);
    if (Number.isNaN(startedAt)) return;
    const tick = () => setElapsedSeconds(Math.max(0, (Date.now() - startedAt) / 1000));
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [conversation]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight });
  }, [messages, sending]);

  const resync = useCallback(async () => {
    if (!conversation || !accessToken) return;
    try {
      const refreshed = await readConversation(accessToken, conversation.session_id);
      setConversation(refreshed);
      setMessages(refreshed.messages);
    } catch {
      // Falha ao ressincronizar não deve derrubar a tela; o aluno continua
      // vendo o que já está carregado.
    }
  }, [accessToken, conversation]);

  const learnerMessageCount = conversation?.learner_message_count ?? 0;
  const maxLearnerMessages = conversation?.max_learner_messages ?? 0;
  const reachedMessageLimit = Boolean(conversation) && learnerMessageCount >= maxLearnerMessages;
  const remainingMessages = Math.max(0, maxLearnerMessages - learnerMessageCount);

  const send = async (text: string, existingRequestId?: string) => {
    if (!conversation || !accessToken || sending) return;
    const trimmed = text.trim();
    if (!trimmed || reachedMessageLimit) return;

    const controller = new AbortController();
    abortRef.current = controller;
    const optimistic: ConversationMessage = {
      sequence: (messages.at(-1)?.sequence ?? 0) + 1,
      role: "learner",
      content: trimmed,
    };
    setMessages((current) => [...current, optimistic]);
    setAnswer("");
    setShowHint(false);
    setSendError("");
    setRetryText("");
    setRetryRequestId("");
    setSending(true);

    try {
      // Uma nova ação recebe um UUID novo; o retry de falhas de rede/persistência
      // reutiliza o mesmo UUID para recuperar a resposta durável sem novo custo.
      const requestId = existingRequestId || crypto.randomUUID();
      generationRequestRef.current = requestId;
      const result = await sendConversationMessage(
        accessToken,
        conversation.session_id,
        { message: trimmed, requestId },
        controller.signal,
      );
      setMessages((current) => [
        ...current.filter((message) => message !== optimistic),
        { ...optimistic, sequence: result.learner_sequence },
        {
          sequence: result.tutor_sequence,
          role: "tutor",
          content: result.result.reply,
          correction: result.result.correction,
        },
      ]);
      setConversation((current) =>
        current
          ? {
              ...current,
              learner_message_count: result.learner_message_count,
              max_learner_messages: result.max_learner_messages,
            }
          : current,
      );
    } catch (error) {
      setMessages((current) => current.filter((message) => message !== optimistic));
      if (controller.signal.aborted) {
        setSendError("Geração cancelada.");
        setRetryText(trimmed);
        // Uma geração efetivamente cancelada precisa de uma nova reserva.
        setRetryRequestId("");
        // A requisição pode ter sido concluída no servidor depois do cancelamento,
        // então relemos o estado real em vez de adivinhar.
        await resync();
      } else {
        setSendError(
          error instanceof ConversationApiError
            ? error.message
            : "Não foi possível enviar sua mensagem.",
        );
        setRetryText(trimmed);
        setRetryRequestId(generationRequestRef.current || "");
        if (error instanceof ConversationApiError && error.status === 409) await resync();
      }
    } finally {
      abortRef.current = null;
      generationRequestRef.current = null;
      setSending(false);
    }
  };

  const cancelGeneration = async () => {
    const requestId = generationRequestRef.current;
    if (requestId && conversation && accessToken) {
      await cancelConversationGeneration(
        accessToken,
        conversation.session_id,
        requestId,
      ).catch(() => undefined);
    }
    abortRef.current?.abort();
  };

  const stopDictation = () => {
    pressingMicRef.current = false;
    const recorder = mediaRecorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
  };

  const startDictation = async () => {
    if (listening || transcribing || mediaRecorderRef.current) return;
    if (!voiceConsent) {
      pressingMicRef.current = false;
      setShowVoiceConsent(true);
      setSpeechError("");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setSpeechError("Este navegador não permite acessar o microfone nesta página.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!pressingMicRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const preferredMimeType = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/webm",
      ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
      const recorder = preferredMimeType
        ? new MediaRecorder(stream, { mimeType: preferredMimeType })
        : new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      const existingAnswer = answer.trim();
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        pressingMicRef.current = false;
        setSpeechError("A gravação foi interrompida pelo navegador.");
        setListening(false);
      };
      recorder.onstop = () => {
        if (recordingTimerRef.current) window.clearTimeout(recordingTimerRef.current);
        recordingTimerRef.current = null;
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        pressingMicRef.current = false;
        setListening(false);
        const audio = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (audio.size < 100) {
          setSpeechError("Nenhum áudio foi capturado. Toque no microfone e tente novamente.");
          return;
        }
        setTranscribing(true);
        void transcribeAudio(accessToken, audio, targetLanguage)
          .then(({ transcript }) => {
            if (!transcript) {
              setSpeechError("Nenhuma fala foi identificada. Tente novamente mais perto do microfone.");
              return;
            }
            setAnswer(existingAnswer ? `${existingAnswer} ${transcript}` : transcript);
            setSpeechError("");
          })
          .catch((error) => {
            setSpeechError(
              error instanceof ConversationApiError
                ? error.message
                : "Não foi possível transcrever o áudio agora.",
            );
          })
          .finally(() => setTranscribing(false));
      };
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      setSpeechError("");
      setListening(true);
      recorder.start(250);
      recordingTimerRef.current = window.setTimeout(() => {
        if (recorder.state === "recording") {
          pressingMicRef.current = false;
          recorder.stop();
        }
      }, 20_000);
    } catch (error) {
      const permissionDenied = error instanceof DOMException
        && (error.name === "NotAllowedError" || error.name === "SecurityError");
      setSpeechError(
        permissionDenied
          ? "Autorize o microfone nas configurações deste site e tente novamente."
          : "Não foi possível acessar o microfone deste dispositivo.",
      );
      pressingMicRef.current = false;
      setListening(false);
    }
  };

  const endSession = async () => {
    if (!conversation || !accessToken || ending) return;
    setEnding(true);
    setSendError("");
    try {
      const completed = await completeConversation(accessToken, conversation.session_id);
      onCompleted({
        sessionId: conversation.session_id,
        scenario,
        targetLanguage,
        summary: completed.summary,
        elapsedSeconds: Math.round(elapsedSeconds),
        messageCount: messages.length,
        learnerMessageCount: conversation.learner_message_count,
        correctionCount: messages.filter((message) => message.correction).length,
      });
    } catch (error) {
      setSendError(
        error instanceof ConversationApiError
          ? error.message
          : "Não foi possível encerrar a conversa agora.",
      );
      setEnding(false);
    }
  };

  const leaveWithoutSummary = async () => {
    if (conversation && accessToken && conversation.learner_message_count === 0) {
      // Sem nenhuma fala do aluno, encerrar a sessão devolve a vaga do dia.
      await abandonConversation(accessToken, conversation.session_id).catch(() => undefined);
    }
    goBack();
  };

  if (startupError) {
    const dailyLimitHit = startupError.includes("limite diário de conversas");
    const showUpgrade = planId !== "premium" && Boolean(onUpgrade);
    return (
      <div className="conversation-screen">
        <header className="conversation-header">
          <button onClick={goBack} aria-label="Voltar para os cenários">
            <ArrowLeft aria-hidden="true" focusable="false" />
          </button>
          <div className="conversation-title">
            <strong>{scenario.title}</strong>
          </div>
        </header>
        <main className="conversation-body conversation-empty">
          <div className="form-message form-error" role="alert">
            {startupError}
          </div>
          {showUpgrade && dailyLimitHit && onUpgrade && (
            <UpgradePrompt
              title="Quer praticar mais hoje?"
              message="Você atingiu o limite diário do Free. No Premium, a prática não para cedo."
              onUpgrade={onUpgrade}
              ctaLabel="Ver planos Premium"
              highlights={UPGRADE_HIGHLIGHTS}
              compact
            />
          )}
          <Button onClick={goBack} icon={<ArrowLeft size={17} />}>
            Escolher outro cenário
          </Button>
        </main>
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="conversation-screen conversation-loading-screen">
        <header className="conversation-header">
          <button onClick={goBack} aria-label="Voltar para os cenários">
            <ArrowLeft aria-hidden="true" focusable="false" />
          </button>
          <div className="conversation-title">
            <span className="mini-avatar">Lu</span>
            <div>
              <strong>{scenario.title}</strong>
              <small>Preparando a prática</small>
            </div>
          </div>
        </header>
        <main className="conversation-body conversation-empty" aria-busy="true">
          <div className="conversation-loading" role="status" aria-live="polite">
            <span className="conversation-loading-icon">
              <LoaderCircle aria-hidden="true" />
            </span>
            <strong>Abrindo sua conversa...</strong>
            <p>Estamos preparando o cenário e recuperando seu histórico.</p>
            <div className="conversation-loading-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          </div>
        </main>
      </div>
    );
  }

  const progress = sessionProgressPercent(
    conversation.learner_message_count,
    conversation.planned_minutes,
    conversation.max_learner_messages,
  );
  const overPlannedTime = elapsedSeconds > conversation.planned_minutes * 60;

  return (
    <div className="conversation-screen">
      <header className="conversation-header">
        <button onClick={() => void leaveWithoutSummary()} aria-label="Voltar para os cenários">
          <ArrowLeft aria-hidden="true" focusable="false" />
        </button>
        <div className="conversation-title">
          <span className="mini-avatar">Lu</span>
          <div>
            <strong>{scenario.title}</strong>
            <small>
              <i /> Lume · {shortLevel(preferences?.currentLevel || "unknown")}
            </small>
          </div>
        </div>
        <div className={`session-timer${overPlannedTime ? " session-timer-over" : ""}`}>
          <Clock3 aria-hidden="true" focusable="false" />
          <span aria-label="Tempo de conversa">{formatElapsed(elapsedSeconds)}</span>
          <small>de {conversation.planned_minutes} min</small>
        </div>
        <Button variant="ghost" onClick={() => void endSession()} disabled={ending || sending}>
          {ending ? "Encerrando..." : "Encerrar"}
        </Button>
      </header>

      <main className="conversation-body">
        <div className="conversation-context">
          {renderScenarioIcon(scenario.icon)}
          <div>
            <span>SEU OBJETIVO</span>
            <strong>{scenario.objective}</strong>
          </div>
          {conversation.resumed && <span className="resumed-chip">Conversa retomada</span>}
        </div>

        {overPlannedTime && !continuedAfterGoal && (
          <div className="session-time-goal" role="status" aria-live="polite">
            <Clock3 aria-hidden="true" />
            <div>
              <strong>Você completou os {conversation.planned_minutes} minutos planejados.</strong>
              <p>Você pode encerrar e receber o resumo ou continuar praticando.</p>
            </div>
            <Button variant="secondary" onClick={() => setContinuedAfterGoal(true)}>
              Continuar
            </Button>
            <Button onClick={() => void endSession()} disabled={ending || sending}>
              Ver resumo
            </Button>
          </div>
        )}

        <div className="conversation-messages" ref={transcriptRef}>
          <div className="time-divider">
            <span>Início da prática</span>
          </div>
          {messages.map((message) => (
            <div key={`${message.role}-${message.sequence}`}>
              <div
                className={`chat-message ${message.role === "learner" ? "user-message" : "tutor-message"}`}
              >
                {message.role === "tutor" && <div className="mini-avatar">Lu</div>}
                <div>
                  <span lang={targetLanguage}>{message.content}</span>
                  {message.role === "tutor" && isPremiumPlan(planId) && (
                    <SpeechPlayback
                      text={message.content}
                      language={targetLanguage}
                      accessToken={accessToken}
                      enabled
                    />
                  )}
                </div>
              </div>
              {message.correction && (
                <div className="inline-feedback compact-feedback">
                  <div className="feedback-title">
                    <CheckCircle2 aria-hidden="true" focusable="false" />
                    <strong>{severityLabels[message.correction.severity] || "Uma correção"}</strong>
                  </div>
                  <div className="compare">
                    <del lang={targetLanguage}>{message.correction.original}</del>
                    <ArrowRight size={15} aria-hidden="true" focusable="false" />
                    <ins lang={targetLanguage}>{message.correction.corrected}</ins>
                  </div>
                  {isPremiumPlan(planId) && (
                    <SpeechPlayback
                      text={message.correction.corrected}
                      language={targetLanguage}
                      accessToken={accessToken}
                      enabled
                      label="Ouvir correção"
                    />
                  )}
                  <p lang="pt-BR">{message.correction.explanation_pt_br}</p>
                </div>
              )}
            </div>
          ))}
          {sending && (
            <div className="chat-message tutor-message typing-indicator">
              <div className="mini-avatar">Lu</div>
              <div>
                <span aria-live="polite">Lume está escrevendo</span>
                <i />
                <i />
                <i />
              </div>
            </div>
          )}
          {sendError && (
            <div className="conversation-error">
              <div className="form-message form-error" role="alert">
                {sendError}
              </div>
              {retryText && (
                <Button
                  variant="secondary"
                  onClick={() => void send(retryText, retryRequestId || undefined)}
                  disabled={sending}
                >
                  Tentar novamente <RotateCcw size={14} aria-hidden="true" focusable="false" />
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="conversation-compose">
          {reachedMessageLimit ? (
            <div className="compose-limit">
              <strong>Esta conversa chegou ao limite de mensagens.</strong>
              {planId !== "premium" && onUpgrade && (
                <UpgradePrompt
                  compact
                  title="Conversas mais longas no Premium"
                  message="Esta conversa chegou ao limite de mensagens do Free. Premium dobra a profundidade de cada sessão."
                  onUpgrade={onUpgrade}
                  ctaLabel="Assinar Premium"
                  highlights={UPGRADE_HIGHLIGHTS}
                />
              )}
              <Button onClick={() => void endSession()} disabled={ending}>
                {ending ? "Gerando resumo..." : "Encerrar e ver o resumo"}
              </Button>
            </div>
          ) : (
            <>
              <div className="hint-row">
                <button
                  type="button"
                  aria-expanded={showHint}
                  onClick={() => {
                    if (showHint) setHintIndex((current) => current + 1);
                    setShowHint(true);
                  }}
                >
                  <Sparkles size={15} aria-hidden="true" focusable="false" /> Preciso de uma dica
                </button>
                <button
                  type="button"
                  disabled
                  aria-label="Traduzir pergunta (disponível em uma etapa futura)"
                >
                  <Languages size={15} aria-hidden="true" focusable="false" /> Traduzir pergunta
                </button>
                {sending && (
                  <button type="button" className="cancel-generation" onClick={cancelGeneration}>
                    <X size={15} aria-hidden="true" focusable="false" /> Cancelar
                  </button>
                )}
              </div>
              {showHint && (
                <div className="conversation-hint" role="status">
                  <div>
                    <Sparkles aria-hidden="true" focusable="false" />
                    <div>
                      <strong>Uma ideia para continuar</strong>
                      <p lang="pt-BR">
                        {scenario.goals[
                          (conversation.learner_message_count + hintIndex) % scenario.goals.length
                        ]}
                      </p>
                    </div>
                    <button type="button" onClick={() => setShowHint(false)} aria-label="Fechar dica">
                      <X aria-hidden="true" focusable="false" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const starters = conversationStarters[targetLanguage] || conversationStarters.en;
                      const starter = starters[hintIndex % starters.length];
                      setAnswer((current) => current.trim() ? `${current} ${starter}` : starter);
                      setShowHint(false);
                    }}
                  >
                    Comece com: <strong>
                      {(conversationStarters[targetLanguage] || conversationStarters.en)[
                        hintIndex % conversationStarters.en.length
                      ]}
                    </strong>
                  </button>
                  <small>A dica orienta a ideia, mas você constrói a resposta.</small>
                </div>
              )}
              <div className="compose-box">
                <button
                  className={`mic-button${listening ? " listening" : ""}`}
                  type="button"
                  disabled={sending || ending || transcribing}
                  title="Pressione e segure para gravar"
                  aria-label="Pressione e segure para gravar áudio; solte para transcrever"
                  aria-pressed={listening}
                  onPointerDown={(event) => {
                    if (!event.isPrimary || event.button !== 0) return;
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    pressingMicRef.current = true;
                    void startDictation();
                  }}
                  onPointerUp={(event) => {
                    event.preventDefault();
                    stopDictation();
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                      event.currentTarget.releasePointerCapture(event.pointerId);
                    }
                  }}
                  onPointerCancel={stopDictation}
                  onKeyDown={(event) => {
                    if ((event.key === " " || event.key === "Enter") && !event.repeat) {
                      event.preventDefault();
                      pressingMicRef.current = true;
                      void startDictation();
                    }
                  }}
                  onKeyUp={(event) => {
                    if (event.key === " " || event.key === "Enter") {
                      event.preventDefault();
                      stopDictation();
                    }
                  }}
                  onContextMenu={(event) => event.preventDefault()}
                >
                  <Mic2 aria-hidden="true" focusable="false" />
                </button>
                <textarea
                  aria-label="Responder"
                  value={answer}
                  disabled={sending || ending}
                  onChange={(event) => setAnswer(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void send(answer);
                    }
                  }}
                  maxLength={2000}
                  placeholder="Digite sua resposta no idioma estudado..."
                />
                <button
                  className="send-button"
                  disabled={!answer.trim() || sending || ending}
                  onClick={() => void send(answer)}
                  aria-label="Enviar mensagem"
                >
                  <ArrowRight aria-hidden="true" focusable="false" />
                </button>
              </div>
              {showVoiceConsent && (
                <div className="voice-consent" role="dialog" aria-label="Autorização para processar áudio">
                  <p>
                    Para transcrever, o áudio será enviado ao Google Gemini e processado
                    temporariamente. O Lume não salva o arquivo de áudio; a transcrição pode ser
                    mantida na conversa.
                  </p>
                  <div>
                    <Button variant="secondary" onClick={() => setShowVoiceConsent(false)}>
                      Agora não
                    </Button>
                    <Button onClick={() => void acceptVoiceConsent()} disabled={savingVoiceConsent}>
                      {savingVoiceConsent ? "Salvando..." : "Aceitar e continuar"}
                    </Button>
                  </div>
                </div>
              )}
              {speechError && <small className="voice-status voice-error" role="alert">{speechError}</small>}
              {listening && <small className="voice-status" role="status">Gravando… continue pressionando e solte para transcrever (máximo de 20 segundos).</small>}
              {transcribing && <small className="voice-status" role="status">Transcrevendo sua fala com segurança…</small>}
              <small>
                Pressione Enter para enviar · Shift + Enter para nova linha ·{" "}
                {remainingMessages} {remainingMessages === 1 ? "mensagem" : "mensagens"} nesta
                conversa
              </small>
            </>
          )}
        </div>
      </main>

      <aside className="conversation-side">
        <div>
          <span className="eyebrow">PROGRESSO DA SESSÃO</span>
          <ProgressRing value={progress} label="ritmo" />
          <small>
            {conversation.learner_message_count}{" "}
            {conversation.learner_message_count === 1 ? "mensagem enviada" : "mensagens enviadas"}
          </small>
        </div>
        <div className="session-goals">
          <h3>Nesta conversa</h3>
          {scenario.goals.map((goal) => (
            <p key={goal}>
              <i /> {goal}
            </p>
          ))}
          <small>O tutor avalia o objetivo no resumo, ao encerrar.</small>
        </div>
        <div className="live-words">
          <h3>Correções desta conversa</h3>
          {messages.some((message) => message.correction) ? (
            messages
              .filter((message) => message.correction)
              .slice(-4)
              .map((message) => (
                <p key={`correction-${message.sequence}`}>
                  <ins>{message.correction?.corrected}</ins>
                </p>
              ))
          ) : (
            <p>Nenhuma correção ainda. Escreva à vontade.</p>
          )}
        </div>
      </aside>
    </div>
  );
}

export function ConversationSummary({
  completed,
  goToScenarios,
  goToDashboard,
  goToSessions,
  onUpgrade,
  planId = "free",
  accessToken = "",
}: {
  completed: CompletedConversationView | null;
  goToScenarios: () => void;
  goToDashboard: () => void;
  goToSessions: () => void;
  onUpgrade?: () => void;
  planId?: string;
  accessToken?: string;
}) {
  if (!completed) {
    return (
      <div className="screen-content summary-screen">
        <div className="learning-loading">
          <CheckCircle2 />
          <p>Nenhum resumo aberto. Veja o histórico das suas conversas.</p>
          <Button onClick={goToSessions}>Ver histórico</Button>
        </div>
      </div>
    );
  }

  const { summary, scenario, targetLanguage } = completed;
  return (
    <div className="screen-content summary-screen">
      <div className="summary-hero">
        <div className="celebration">✦</div>
        <span className="eyebrow light">SESSÃO CONCLUÍDA</span>
        <h1>{summary.headline_pt_br}</h1>
        <p>{summary.encouragement_pt_br}</p>
        <div className="summary-stats">
          <div>
            <strong>{formatElapsed(completed.elapsedSeconds)}</strong>
            <span>tempo</span>
          </div>
          <div>
            <strong>{completed.messageCount}</strong>
            <span>mensagens</span>
          </div>
          <div>
            <strong>{summary.vocabulary.length}</strong>
            <span>palavras salvas</span>
          </div>
          <div>
            <strong>{completed.correctionCount}</strong>
            <span>correções</span>
          </div>
        </div>
      </div>
      <div className="summary-layout">
        <main>
          <div className="score-card">
            <div>
              <span className="eyebrow">OBJETIVO DO CENÁRIO</span>
              <h2>{scenario.objective}</h2>
              <p>
                A estimativa considera apenas o que aconteceu nesta conversa, avaliado pelo tutor.
              </p>
            </div>
            <ProgressRing value={summary.objective_progress} label="objetivo" />
          </div>
          <div className="feedback-grid">
            <article className="strength-card">
              <div className="card-title">
                <CheckCircle2 />
                <strong>Pontos fortes</strong>
              </div>
              {summary.strengths_pt_br.map((strength) => (
                <p key={strength}>
                  <CheckCircle2 size={15} /> {strength}
                </p>
              ))}
            </article>
            <article className="focus-card">
              <div className="card-title">
                <RotateCcw />
                <strong>Para melhorar</strong>
              </div>
              {summary.focus_areas.length ? (
                summary.focus_areas.map((area, index) => (
                  <div className="focus-item" key={area.title_pt_br}>
                    <span>{index + 1}</span>
                    <div>
                      <strong>{area.title_pt_br}</strong>
                      <small>{area.detail_pt_br}</small>
                    </div>
                  </div>
                ))
              ) : (
                <div className="focus-item">
                  <div>
                    <small>O tutor não identificou pontos de melhoria nesta conversa.</small>
                  </div>
                </div>
              )}
            </article>
          </div>
          <div className="saved-words">
            <div className="section-heading compact">
              <div>
                <span className="eyebrow">VOCABULÁRIO</span>
                <h2>Palavras desta conversa</h2>
              </div>
            </div>
            {summary.vocabulary.length ? (
              <div>
                {summary.vocabulary.map((item) => (
                  <span key={item.term}>
                    {item.term}
                    <small>{item.translation_pt_br}</small>
                    {accessToken && isPremiumPlan(planId) && (
                      <SpeechPlayback
                        text={item.term}
                        language={targetLanguage}
                        accessToken={accessToken}
                        enabled
                        label="Ouvir"
                      />
                    )}
                  </span>
                ))}
              </div>
            ) : (
              <p className="form-message">
                Nenhuma palavra nova foi destacada. Elas aparecem quando surgem na conversa.
              </p>
            )}
          </div>
        </main>
        <aside>
          {planId !== "premium" && onUpgrade && (
            <UpgradePrompt
              title="Gostou da prática?"
              message="Mantenha o ritmo amanhã com muito mais conversa, voz e feedback do tutor."
              onUpgrade={onUpgrade}
              ctaLabel="Ver Premium"
              highlights={UPGRADE_HIGHLIGHTS}
            />
          )}
          <div className="next-card">
            <span className="eyebrow">PRÓXIMO PASSO</span>
            <div className="next-icon">
              <ArrowRight />
            </div>
            <h3>Praticar outro cenário</h3>
            <p>Alternar cenários ajuda você a usar o idioma em situações diferentes.</p>
            <Button full onClick={goToScenarios}>
              Escolher cenário
            </Button>
            <div className="next-card-actions">
              <Button full variant="secondary" onClick={goToSessions}>
                Ver histórico de conversas
              </Button>
              <button onClick={goToDashboard}>Voltar ao início</button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
