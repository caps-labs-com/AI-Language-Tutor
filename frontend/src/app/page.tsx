"use client";

import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bell,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Coffee,
  CreditCard,
  Download,
  Eye,
  EyeOff,
  Flame,
  Globe2,
  GraduationCap,
  Heart,
  History,
  Home,
  Languages,
  LockKeyhole,
  LogIn,
  Mail,
  Map,
  MessageCircle,
  Mic2,
  Play,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Trophy,
  UserPlus,
  Volume2,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { AdminPanel } from "@/components/admin/admin-panel";
import { AppHeader } from "@/components/app-header";
import { GrammarFormation } from "@/components/grammar-formation";
import { AppNav } from "@/components/app-nav";
import {
  Conversation,
  ConversationSummary,
  type CompletedConversationView,
} from "@/components/conversation";
import { categoryLabels, levelRange, renderScenarioIcon } from "@/components/scenario-icons";
import { SessionHistory } from "@/components/sessions";
import { SpeechPlayback } from "@/components/speech-playback";
import { Brand, Button, ProgressRing, Stat } from "@/components/ui";
import {
  loadScenarioCatalog,
  recommendScenario,
  type ScenarioCatalogItem,
} from "@/lib/conversation";
import { loadEntitlements, planLabel, type EntitlementsSummary } from "@/lib/entitlements";
import { isNearLimit, UPGRADE_HIGHLIGHTS } from "@/lib/pricing";
import { UpgradePrompt } from "@/components/upgrade-prompt";
import { PlanComparison } from "@/components/plan-comparison";
import { PricingScreen } from "@/components/pricing-screen";
import { BillingAccountPanel } from "@/components/billing-account-panel";
import { BillingResultScreen } from "@/components/billing-result-screen";
import { loadIsAdmin } from "@/lib/admin";
import {
  goalLabels,
  languageDetails,
  levelLabels,
  mapLearnerPreferences,
  selectableLevels,
  shortLevel,
  type AuthFeedback,
  type IconType,
  type LearnerPreferences,
  type LearnerPreferencesRow,
  type OnboardingData,
  type ScreenId,
  type TargetLanguage,
} from "@/lib/learner";
import { LearnerProvider, useLearner } from "@/lib/learner-context";
import {
  fallbackStudiedLanguages,
  mapLearnerLanguages,
  type LearnerLanguage,
  type LearnerLanguageRow,
} from "@/lib/learner-languages";
import {
  loadLearnerLearningProgress,
  loadLearningContent,
  loadReviewItems,
  type LearningContent,
  type LearningLevel,
  type LearningSection,
  type LearningSectionProgress,
} from "@/lib/learning-content";
import { calculateDashboardMetrics } from "@/lib/progress";
import {
  isEmailConfirmed,
  isPasswordRecoveryCallback,
  onboardingStorageKeys,
  passwordRecoveryRedirectUrl,
  resolveDestination,
  scenarioStorageKey,
  validateNewPassword,
} from "@/lib/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase";

type AuthMode = "signup" | "login" | "recover" | "update";

type AuthFormData = {
  name: string;
  email: string;
  password: string;
};

const screens: Array<{ id: ScreenId; label: string; icon: IconType; group: string }> = [
  { id: "landing", label: "Landing", icon: Sparkles, group: "Entrada" },
  { id: "demo", label: "Demonstração", icon: MessageCircle, group: "Entrada" },
  { id: "signup", label: "Cadastro", icon: UserPlus, group: "Entrada" },
  { id: "login", label: "Login", icon: LogIn, group: "Entrada" },
  { id: "recover", label: "Recuperar senha", icon: Mail, group: "Entrada" },
  { id: "confirm-email", label: "Confirmar email", icon: Mail, group: "Entrada" },
  { id: "onboarding", label: "Onboarding", icon: Target, group: "Entrada" },
  { id: "dashboard", label: "Início", icon: Home, group: "Produto" },
  { id: "learn", label: "Aprender", icon: GraduationCap, group: "Produto" },
  { id: "plan", label: "Plano", icon: Map, group: "Produto" },
  { id: "scenarios", label: "Cenários", icon: Globe2, group: "Produto" },
  { id: "conversation", label: "Conversa", icon: Mic2, group: "Produto" },
  { id: "summary", label: "Resumo", icon: CheckCircle2, group: "Produto" },
  { id: "sessions", label: "Histórico de conversas", icon: History, group: "Produto" },
  { id: "vocabulary", label: "Revisar", icon: RotateCcw, group: "Produto" },
  { id: "assessment", label: "Avaliação", icon: GraduationCap, group: "Progresso" },
  { id: "progress", label: "Progresso", icon: BarChart3, group: "Progresso" },
  { id: "profile", label: "Perfil", icon: Settings, group: "Conta" },
  { id: "privacy", label: "Dados e privacidade", icon: ShieldCheck, group: "Conta" },
  { id: "pricing", label: "Planos", icon: CreditCard, group: "Conta" },
  {
    id: "billing-success",
    label: "Pagamento confirmado",
    icon: CheckCircle2,
    group: "Conta",
  },
  { id: "billing-cancel", label: "Pagamento cancelado", icon: X, group: "Conta" },
  { id: "admin", label: "Admin", icon: ShieldCheck, group: "Operação" },
];

const appScreens = new Set<ScreenId>([
  "dashboard",
  "learn",
  "plan",
  "scenarios",
  "conversation",
  "summary",
  "sessions",
  "vocabulary",
  "assessment",
  "progress",
  "profile",
  "privacy",
]);

function Landing({ go }: { go: (id: ScreenId) => void }) {
  const showDetails = () => document.getElementById("como-funciona")?.scrollIntoView({ behavior: "smooth" });
  return (
    <main className="landing">
      <header className="public-header">
        <Brand onClick={() => go("landing")} />
        <nav>
          <button onClick={showDetails}>Como funciona</button>
          <button onClick={showDetails}>Plano de estudo</button>
        </nav>
        <div className="header-actions">
          <Button variant="ghost" onClick={() => go("login")}>Entrar</Button>
          <Button onClick={() => go("demo")} icon={<ArrowRight size={18} />}>Experimentar</Button>
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow"><Sparkles size={16} /> Tutor pessoal com IA</span>
          <h1>Fale com confiança.<br /><em>Aprenda do seu jeito.</em></h1>
          <p>
            Conversas reais, correções gentis e um plano que se adapta ao seu
            ritmo — em inglês, espanhol, francês ou italiano.
          </p>
          <div className="hero-actions">
            <Button onClick={() => go("demo")} icon={<Play size={18} fill="currentColor" />}>
              Fazer uma conversa grátis
            </Button>
            <span>Sem cadastro · 3 interações</span>
          </div>
          <div className="trust-row">
            <div className="avatars"><span>AM</span><span>JV</span><span>LS</span></div>
            <div><strong>Feito para brasileiros</strong><small>Explicações que fazem sentido para você</small></div>
          </div>
        </div>
        <div className="hero-visual">
          <div className="orbit orbit-one" />
          <div className="orbit orbit-two" />
          <div className="tutor-card">
            <div className="tutor-head">
              <div className="tutor-avatar">Lu</div>
              <div><strong>Lume</strong><span><i /> Tutor online</span></div>
              <Volume2 size={20} />
            </div>
            <div className="bubble bubble-tutor">
              <small>ENGLISH · A2</small>
              How would you order your favorite coffee?
            </div>
            <div className="bubble bubble-user">I want one coffee with milk, please.</div>
            <div className="correction">
              <Check size={16} />
              <div><strong>Quase perfeito!</strong><span>“I’d like a coffee with milk, please.” soa mais natural.</span></div>
            </div>
            <div className="composer">
              <Mic2 size={21} />
              <span>Responda por voz ou texto...</span>
              <ArrowRight size={18} />
            </div>
          </div>
          <div className="floating-badge badge-streak"><Flame size={18} /> 7 dias</div>
          <div className="floating-badge badge-progress"><Trophy size={18} /> +24% fluência</div>
        </div>
      </section>

      <section className="value-strip" id="como-funciona">
        <article><MessageCircle /><strong>Converse de verdade</strong><span>Cenários que você vai usar.</span></article>
        <article><WandSparkles /><strong>Correção na hora</strong><span>Clara, gentil e contextual.</span></article>
        <article><Map /><strong>Plano só seu</strong><span>Adaptado à sua rotina.</span></article>
        <article><BarChart3 /><strong>Progresso visível</strong><span>Sem métricas vazias.</span></article>
      </section>
    </main>
  );
}

function Demo({ go }: { go: (id: ScreenId) => void }) {
  const [answer, setAnswer] = useState("");
  const [interactions, setInteractions] = useState(1);
  const [messages, setMessages] = useState<Array<{ role: "user" | "tutor"; text: string }>>([]);
  const remaining = Math.max(0, 3 - interactions);

  useEffect(() => {
    if (remaining !== 0) return;
    const redirect = window.setTimeout(() => go("signup"), 1800);
    return () => window.clearTimeout(redirect);
  }, [go, remaining]);

  const send = () => {
    const text = answer.trim();
    if (!text || remaining === 0) return;
    const tutorReplies = [
      "Sounds good! What size would you like?",
      "Perfect! Anything else for you today?",
    ];
    setMessages((current) => [
      ...current,
      { role: "user", text },
      { role: "tutor", text: tutorReplies[Math.min(interactions - 1, tutorReplies.length - 1)] },
    ]);
    setAnswer("");
    setInteractions((current) => current + 1);
  };
  return (
    <div className="public-shell demo-shell">
      <header className="simple-header"><Brand onClick={() => go("landing")} /><span className="step-label">Demonstração · 2 de 3</span><button onClick={() => go("landing")}><X /></button></header>
      <main className="demo-main">
        <div className="demo-context">
          <span className="scenario-icon"><Coffee /></span>
          <div><small>CENÁRIO</small><h2>Pedido em uma cafeteria</h2><p>Pratique uma situação comum em inglês.</p></div>
          <span className="level-chip">A2</span>
        </div>
        <div className="chat-stream">
          <div className="chat-message tutor-message"><div className="mini-avatar">Lu</div><div><span>Good morning! What can I get for you today?</span></div></div>
          <div className="chat-message user-message"><div><span>I want one coffee with milk, please.</span><small>Agora</small></div></div>
          <div className="inline-feedback">
            <div className="feedback-title"><CheckCircle2 /><strong>Boa resposta!</strong><span>1 ajuste</span></div>
            <div className="compare"><del>I want one coffee</del><ArrowRight size={15}/><ins>I’d like a coffee</ins></div>
            <p>Em pedidos, <strong>“I’d like...”</strong> soa mais natural e educado.</p>
            <button disabled title="A demonstração interativa será conectada ao tutor de IA">Tentar novamente <RotateCcw size={14} /></button>
          </div>
          <div className="chat-message tutor-message"><div className="mini-avatar">Lu</div><div><span>Great choice! Would you like it hot or iced?</span></div></div>
          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`chat-message ${message.role === "user" ? "user-message" : "tutor-message"}`}>
              {message.role === "tutor" && <div className="mini-avatar">Lu</div>}
              <div><span>{message.text}</span></div>
            </div>
          ))}
        </div>
        <div className="demo-composer">
          <button className="mic-button" disabled title="Entrada por voz ainda não disponível"><Mic2 /></button>
          <input
            aria-label="Sua resposta"
            value={answer}
            disabled={remaining === 0}
            onChange={(event) => setAnswer(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") send();
            }}
            placeholder={remaining ? "Digite sua resposta em inglês..." : "Demonstração concluída"}
          />
          <button className="send-button" disabled={!answer.trim() || remaining === 0} onClick={send} aria-label="Enviar resposta"><ArrowRight /></button>
        </div>
        <small className="demo-note">
          {remaining > 0
            ? `Você tem mais ${remaining} ${remaining === 1 ? "interação grátis" : "interações grátis"}`
            : "Demonstração concluída. Abrindo a criação da sua conta..."}
        </small>
      </main>
    </div>
  );
}

function AuthScreen({
  mode,
  go,
  submit,
}: {
  mode: AuthMode;
  go: (id: ScreenId) => void;
  submit: (mode: AuthMode, data: AuthFormData) => Promise<AuthFeedback>;
}) {
  const [form, setForm] = useState<AuthFormData>({ name: "", email: "", password: "" });
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [feedback, setFeedback] = useState<AuthFeedback>({});
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const copy = {
    signup: { title: "Crie seu espaço de aprendizagem", subtitle: "Salve seu progresso e receba um plano feito para você.", action: "Criar conta" },
    login: { title: "Que bom ter você de volta", subtitle: "Continue exatamente de onde parou.", action: "Entrar" },
    recover: { title: "Recupere seu acesso", subtitle: "Enviaremos um link seguro para redefinir sua senha.", action: "Enviar link" },
    update: { title: "Crie uma nova senha", subtitle: "Escolha uma senha segura com pelo menos oito caracteres.", action: "Atualizar senha" },
  }[mode];

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback({});

    if (mode === "signup" && !acceptedTerms) {
      setFeedback({ error: "Você precisa aceitar os Termos e a Política de Privacidade." });
      return;
    }

    setSubmitting(true);
    setFeedback(await submit(mode, form));
    setSubmitting(false);
  };

  return (
    <div className="auth-layout">
      <aside className="auth-aside">
        <Brand onClick={() => go("landing")} />
        <div>
          <span className="eyebrow light"><Heart size={16}/> Aprendizado sem pressão</span>
          <h2>Seu próximo idioma começa com uma conversa.</h2>
          <blockquote>“As correções explicam exatamente o que eu precisava, sem quebrar o ritmo da conversa.”</blockquote>
          <div className="quote-person"><span>MR</span><div><strong>Marina R.</strong><small>Aprendendo inglês · A2</small></div></div>
        </div>
        <small>© 2026 Lume · Privacidade em primeiro lugar</small>
      </aside>
      <main className="auth-main">
        <button className="back-link" onClick={() => go("landing")}><ArrowLeft size={16}/> Voltar</button>
        <form className="auth-card" onSubmit={handleSubmit}>
          <h1>{copy.title}</h1><p>{copy.subtitle}</p>
          {mode === "signup" && <label>Nome<input required maxLength={100} autoComplete="name" value={form.name} onChange={(event) => setForm({...form, name: event.target.value})} placeholder="Como podemos chamar você?" /></label>}
          {mode !== "update" && <label>Email<input required type="email" autoComplete="email" value={form.email} onChange={(event) => setForm({...form, email: event.target.value})} placeholder="voce@email.com" /></label>}
          {mode !== "recover" && <label>Senha<div className="password-wrap"><LockKeyhole className="password-lock" size={17}/><input required minLength={mode === "login" ? 1 : 12} maxLength={128} type={showPassword ? "text" : "password"} autoComplete={mode === "login" ? "current-password" : "new-password"} value={form.password} onChange={(event) => setForm({...form, password: event.target.value})} placeholder={mode === "login" ? "Sua senha" : "12+ caracteres, maiúscula, número e símbolo"} /><button className="password-toggle" type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} aria-pressed={showPassword}>{showPassword ? <EyeOff size={19}/> : <Eye size={19}/>}</button></div></label>}
          {mode === "login" && <button type="button" className="forgot" onClick={() => go("recover")}>Esqueci minha senha</button>}
          {mode === "signup" && <label className="check-label"><input type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)}/> <span>Li e aceito os Termos e a Política de Privacidade.</span></label>}
          {feedback.error && <div className="form-message form-error" role="alert">{feedback.error}</div>}
          {feedback.success && <div className="form-message form-success" role="status">{feedback.success}</div>}
          <Button full type="submit" disabled={submitting} icon={submitting ? undefined : <ArrowRight size={18}/>}>{submitting ? "Aguarde..." : copy.action}</Button>
          {(mode === "signup" || mode === "login") && <p className="auth-switch">{mode === "signup" ? "Já tem uma conta?" : "Ainda não tem uma conta?"} <button type="button" onClick={() => go(mode === "signup" ? "login" : "signup")}>{mode === "signup" ? "Entrar" : "Criar conta"}</button></p>}
        </form>
      </main>
    </div>
  );
}

function ConfirmEmail({
  email,
  go,
  resend,
  checkConfirmation,
}: {
  email: string;
  go: (id: ScreenId) => void;
  resend: (email: string) => Promise<AuthFeedback>;
  checkConfirmation: () => Promise<AuthFeedback>;
}) {
  const [cooldown, setCooldown] = useState(0);
  const [feedback, setFeedback] = useState<AuthFeedback>({});
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const resendEmail = async () => {
    if (!email || cooldown > 0 || resending) return;
    setResending(true);
    setFeedback({});
    const result = await resend(email);
    setFeedback(result);
    if (!result.error) setCooldown(60);
    setResending(false);
  };

  const verify = async () => {
    setChecking(true);
    setFeedback(await checkConfirmation());
    setChecking(false);
  };

  const maskedEmail = email
    ? email.replace(/^(.{2}).*(@.*)$/, "$1••••$2")
    : "seu endereço de email";

  return (
    <div className="confirmation-page">
      <header className="simple-header">
        <Brand onClick={() => go("landing")}/>
        <button onClick={() => go("login")}>Já tenho uma conta</button>
      </header>
      <main className="confirmation-card">
        <div className="confirmation-illustration">
          <span><Mail size={38}/></span>
          <i><Check size={17}/></i>
        </div>
        <span className="eyebrow">SÓ FALTA UM PASSO</span>
        <h1>Confirme seu email</h1>
        <p>Se este for um cadastro novo, enviaremos um link para</p>
        <strong className="confirmation-email">{maskedEmail}</strong>
        <div className="confirmation-instructions">
          <div><span>1</span><p><strong>Abra sua caixa de entrada</strong><small>Procure pelo email do Lume. Se você já possui conta, use o login ou recupere sua senha.</small></p></div>
          <div><span>2</span><p><strong>Clique em “Confirmar email”</strong><small>Você voltará automaticamente para criar seu plano.</small></p></div>
        </div>
        {feedback.error && <div className="form-message form-error" role="alert">{feedback.error}</div>}
        {feedback.success && <div className="form-message form-success" role="status">{feedback.success}</div>}
        <Button full onClick={verify} disabled={checking} icon={checking ? undefined : <CheckCircle2 size={18}/>}>
          {checking ? "Verificando..." : "Já confirmei meu email"}
        </Button>
        <div className="confirmation-resend">
          <span>Não recebeu?</span>
          <button disabled={!email || cooldown > 0 || resending} onClick={resendEmail}>
            {resending ? "Reenviando..." : cooldown > 0 ? `Reenviar em ${cooldown}s` : "Reenviar email"}
          </button>
        </div>
        <button className="change-email" onClick={() => go("signup")}>
          Informei o email errado
        </button>
        <aside><ShieldCheck size={17}/><span>O link expira por segurança. Verifique também spam e promoções.</span></aside>
      </main>
    </div>
  );
}

function Onboarding({
  complete,
  go,
  initialPreferences,
  userId,
}: {
  complete: (data: OnboardingData) => Promise<AuthFeedback>;
  go: (id: ScreenId) => void;
  initialPreferences: LearnerPreferences | null;
  userId: string;
}) {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<OnboardingData>({
    targetLanguage: initialPreferences?.targetLanguage || "en",
    currentLevel: initialPreferences?.currentLevel || "unknown",
    learningGoal: initialPreferences?.learningGoal || "conversation",
    studyMinutesPerDay: initialPreferences?.studyMinutesPerDay || 20,
    correctionPreference: initialPreferences?.correctionPreference || "immediate",
    interests: initialPreferences?.interests || [],
    desiredScenarios: initialPreferences?.desiredScenarios || [],
  });
  const [draftRestored, setDraftRestored] = useState(false);
  const [feedback, setFeedback] = useState<AuthFeedback>({});
  const [submitting, setSubmitting] = useState(false);
  const questions = [
    { title: "Qual idioma você quer aprender primeiro?", subtitle: "Você poderá adicionar outros idiomas quando quiser." },
    { title: "Como está seu nível hoje?", subtitle: "Não se preocupe: você poderá fazer uma avaliação depois." },
    { title: "Qual é seu principal objetivo?", subtitle: "Usaremos isso para priorizar cenários e vocabulário." },
    { title: "Quanto tempo cabe na sua rotina?", subtitle: "Uma meta realista funciona melhor do que uma meta perfeita." },
    { title: "Como você prefere receber correções?", subtitle: "Você poderá mudar essa preferência no perfil." },
    { title: "O que mais combina com você?", subtitle: "Escolha interesses e tipos de cenário para personalizar as recomendações." },
  ];
  const totalSteps = questions.length;

  const toggleSelection = (
    field: "interests" | "desiredScenarios",
    value: string,
  ) => {
    const selected = data[field];
    setData({
      ...data,
      [field]: selected.includes(value)
        ? selected.filter((item) => item !== value)
        : [...selected, value],
    });
  };

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const keys = onboardingStorageKeys(userId);
      const savedDraft = window.sessionStorage.getItem(keys.draft);
      const savedStep = Number(window.sessionStorage.getItem(keys.step));
      if (savedDraft) {
        try {
          setData(JSON.parse(savedDraft) as OnboardingData);
        } catch {
          window.sessionStorage.removeItem(keys.draft);
        }
      }
      if (savedStep >= 1 && savedStep <= totalSteps) setStep(savedStep);
      setDraftRestored(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [totalSteps, userId]);

  useEffect(() => {
    if (!draftRestored) return;
    const keys = onboardingStorageKeys(userId);
    window.sessionStorage.setItem(keys.draft, JSON.stringify(data));
    window.sessionStorage.setItem(keys.step, String(step));
  }, [data, draftRestored, step, userId]);

  const next = async () => {
    if (step < totalSteps) {
      setStep(step + 1);
      return;
    }
    setSubmitting(true);
    const result = await complete(data);
    setFeedback(result);
    if (!result.error) {
      const keys = onboardingStorageKeys(userId);
      window.sessionStorage.removeItem(keys.draft);
      window.sessionStorage.removeItem(keys.step);
    }
    setSubmitting(false);
  };

  return (
    <div className="onboarding-shell">
      <header className="simple-header"><Brand onClick={() => go("landing")}/><span className="step-label">Passo {step} de {totalSteps}</span><span /></header>
      <div className="onboarding-progress">{Array.from({ length: totalSteps }, (_, index) => index + 1).map((item) => <i key={item} className={item <= step ? "complete" : ""}/>)}</div>
      <main className="onboarding-main">
        <span className="question-count">{String(step).padStart(2, "0")}</span>
        <h1>{questions[step - 1].title}</h1>
        <p>{questions[step - 1].subtitle}</p>
        {step === 1 && <div className="language-grid">
          {([
            ["🇺🇸", "Inglês", "English", "en"],
            ["🇪🇸", "Espanhol", "Español", "es"],
            ["🇫🇷", "Francês", "Français", "fr"],
            ["🇮🇹", "Italiano", "Italiano", "it"],
          ] as const).map(([flag, name, native, value]) => (
            <button key={value} className={data.targetLanguage === value ? "selected" : ""} onClick={() => setData({...data, targetLanguage: value})}>
              <span>{flag}</span><div><strong>{name}</strong><small>{native}</small></div>{data.targetLanguage === value && <CheckCircle2/>}
            </button>
          ))}
        </div>}
        {step === 2 && <div className="language-grid choice-grid">
          {([
            ["Nunca estudei", "Começar do início", "unknown"],
            ["A1 · Iniciante", "Entendo palavras e frases simples", "A1"],
            ["A2 · Básico", "Lido com situações cotidianas", "A2"],
            ["B1 · Intermediário", "Consigo manter conversas", "B1"],
            ["B2 · Independente", "Converso com boa fluência", "B2"],
          ] as const).map(([name, description, value]) => (
            <button key={value} className={data.currentLevel === value ? "selected" : ""} onClick={() => setData({...data, currentLevel: value})}>
              <div><strong>{name}</strong><small>{description}</small></div>{data.currentLevel === value && <CheckCircle2/>}
            </button>
          ))}
        </div>}
        {step === 3 && <div className="language-grid choice-grid">
          {([
            ["✈️", "Viajar", "Usar o idioma em viagens", "travel"],
            ["💼", "Carreira", "Trabalho e oportunidades", "career"],
            ["💬", "Conversação", "Falar com mais confiança", "conversation"],
            ["🎓", "Provas", "Preparação para certificações", "exam"],
          ] as const).map(([icon, name, description, value]) => (
            <button key={value} className={data.learningGoal === value ? "selected" : ""} onClick={() => setData({...data, learningGoal: value})}>
              <span>{icon}</span><div><strong>{name}</strong><small>{description}</small></div>{data.learningGoal === value && <CheckCircle2/>}
            </button>
          ))}
        </div>}
        {step === 4 && <div className="language-grid choice-grid">
          {([10, 20, 30, 60] as const).map((minutes) => (
            <button key={minutes} className={data.studyMinutesPerDay === minutes ? "selected" : ""} onClick={() => setData({...data, studyMinutesPerDay: minutes})}>
              <div><strong>{minutes} minutos por dia</strong><small>{minutes <= 10 ? "Uma rotina leve" : minutes <= 20 ? "Recomendado para consistência" : "Para avançar mais rápido"}</small></div>{data.studyMinutesPerDay === minutes && <CheckCircle2/>}
            </button>
          ))}
        </div>}
        {step === 5 && <div className="language-grid choice-grid">
          {([
            ["Durante a conversa", "Corrigir um ponto importante de cada vez", "immediate"],
            ["Em pequenos grupos", "Agrupar os principais ajustes sem interromper tanto", "grouped"],
            ["Somente ao final", "Priorizar fluidez e revisar no resumo", "final"],
          ] as const).map(([name, description, value]) => (
            <button key={value} className={data.correctionPreference === value ? "selected" : ""} onClick={() => setData({...data, correctionPreference: value})}>
              <div><strong>{name}</strong><small>{description}</small></div>{data.correctionPreference === value && <CheckCircle2/>}
            </button>
          ))}
        </div>}
        {step === 6 && <div className="onboarding-preferences">
          <fieldset>
            <legend>Interesses</legend>
            <div className="filter-pills">
              {([["travel", "Viagens"], ["culture", "Cultura"], ["business", "Negócios"], ["food", "Gastronomia"], ["technology", "Tecnologia"], ["music", "Música"]] as const).map(([value, label]) => (
                <button type="button" key={value} className={data.interests.includes(value) ? "active" : ""} aria-pressed={data.interests.includes(value)} onClick={() => toggleSelection("interests", value)}>{label}</button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Cenários desejados</legend>
            <div className="filter-pills">
              {([["daily", "Cotidiano"], ["professional", "Profissional"], ["travel", "Viagem"]] as const).map(([value, label]) => (
                <button type="button" key={value} className={data.desiredScenarios.includes(value) ? "active" : ""} aria-pressed={data.desiredScenarios.includes(value)} onClick={() => toggleSelection("desiredScenarios", value)}>{label}</button>
              ))}
            </div>
          </fieldset>
        </div>}
        {feedback.error && <div className="form-message form-error" role="alert">{feedback.error}</div>}
        <div className="onboarding-actions">
          <Button variant="ghost" disabled={step === 1 || submitting} onClick={() => setStep(Math.max(1, step - 1))}><ArrowLeft size={18}/> Voltar</Button>
          <Button onClick={next} disabled={submitting} icon={submitting ? undefined : <ArrowRight size={18}/>}>{submitting ? "Salvando..." : step === totalSteps ? "Criar meu plano" : "Continuar"}</Button>
        </div>
      </main>
    </div>
  );
}

function Dashboard({ go, displayName, preferences, session, scenarios, startScenario }: { go: (id: ScreenId) => void; displayName: string; preferences: LearnerPreferences | null; session: Session | null; scenarios: ScenarioCatalogItem[]; startScenario: (scenario: ScenarioCatalogItem) => void }) {
  const level = shortLevel(preferences?.currentLevel || "unknown");
  const language = preferences ? languageDetails[preferences.targetLanguage].name : "Inglês";
  const recommended = recommendScenario(scenarios, preferences?.currentLevel || "unknown", preferences || undefined);
  const [metrics, setMetrics] = useState(() => calculateDashboardMetrics([], preferences?.studyDaysPerWeek || 5));
  const [metricsLoading, setMetricsLoading] = useState(true);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      return;
    }

    let active = true;
    const loadMetrics = async () => {
      setMetricsLoading(true);
      const [learningResult, conversationResult] = await Promise.all([
        supabase
          .from("learning_activity_events")
          .select("completed_at")
          .eq("user_id", session.user.id),
        supabase
          .from("conversation_sessions")
          .select("started_at")
          .eq("user_id", session.user.id)
          .gt("learner_message_count", 0),
      ]);
      if (!active) return;
      const conversationDays = new Set<string>();
      const conversationTimestamps = (conversationResult.data || [])
        .map(({ started_at }) => started_at)
        .filter((timestamp) => {
          const day = timestamp.slice(0, 10);
          if (conversationDays.has(day)) return false;
          conversationDays.add(day);
          return true;
        });
      const timestamps = [
        ...(learningResult.data || []).map(({ completed_at }) => completed_at),
        ...conversationTimestamps,
      ];
      setMetrics(calculateDashboardMetrics(timestamps, preferences?.studyDaysPerWeek || 5));
      setMetricsLoading(false);
    };
    void loadMetrics();
    return () => { active = false; };
  }, [preferences?.studyDaysPerWeek, session]);

  const monthlyTarget = metrics.weeklyTarget * 4;
  const monthlyPercent = Math.min(100, Math.round((metrics.activitiesThisMonth / monthlyTarget) * 100));
  const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(new Date());
  return (
    <div className="screen-content dashboard-screen">
      <AppHeader title={`Olá, ${displayName}!`} subtitle={`Continue avançando em ${language}.`} displayName={displayName} onNavigate={go}/>
      <div className="streak-banner">
        <div className="streak-main"><span><Flame/></span><div><small>SEQUÊNCIA ATUAL</small><strong>{metricsLoading ? "…" : `${metrics.streak} ${metrics.streak === 1 ? "dia" : "dias"}`}</strong></div></div>
        <div className="week-dots">{["S","T","Q","Q","S","S","D"].map((day, index)=><div key={`${day}-${index}`} className={metrics.activeWeekdays[index] ? "done" : ""}><span>{day}</span><i>{metrics.activeWeekdays[index] ? <Check size={12}/> : ""}</i></div>)}</div>
        <p>{metricsLoading ? "Carregando seu progresso…" : <>Você estudou <strong>{metrics.activeDaysThisWeek} de {metrics.weeklyTarget} dias</strong> nesta semana. Hoje: <strong>{metrics.completedToday}</strong>.</>}</p>
      </div>
      <section className="dashboard-grid">
        <div className="main-column">
          <div className="section-heading"><div><span className="eyebrow">PRÓXIMA CONVERSA</span><h2>Pratique falando</h2></div><button onClick={() => go("sessions")}>Ver histórico <ArrowRight size={16}/></button></div>
          {recommended ? (
            <article className="next-lesson">
              <div className="lesson-visual"><div className="coffee-cup">{renderScenarioIcon(recommended.icon)}</div><span>{categoryLabels[recommended.category]}</span></div>
              <div className="lesson-copy"><span className="level-chip">{levelRange(recommended.minLevel, recommended.maxLevel)} · {categoryLabels[recommended.category].toUpperCase()}</span><h3>{recommended.title}</h3><p>{recommended.description}</p><div className="lesson-meta"><span><Clock3 size={16}/> {recommended.plannedMinutes} min</span><span><MessageCircle size={16}/> Conversa guiada em {language}</span></div><Button onClick={() => startScenario(recommended)} icon={<Play size={17} fill="currentColor"/>}>Começar conversa</Button></div>
              <ProgressRing value={metrics.weeklyPercent} label="semana"/>
            </article>
          ) : (
            <article className="next-lesson"><div className="lesson-copy"><h3>Cenários indisponíveis</h3><p>Não foi possível carregar o catálogo de conversas agora.</p></div></article>
          )}
          <div className="section-heading compact"><h2>Pratique do seu jeito</h2></div>
          <div className="quick-grid">
            <button onClick={() => go("scenarios")}><span className="quick-icon coral"><MessageCircle/></span><div><strong>Conversar</strong><small>{scenarios.length ? `${scenarios.length} cenários disponíveis` : "Escolha um cenário"}</small></div><ChevronRight/></button>
            <button onClick={() => go("learn")}><span className="quick-icon teal"><BookOpen/></span><div><strong>Aprender</strong><small>Leitura, gramática e flashcards</small></div><ChevronRight/></button>
            <button onClick={() => go("vocabulary")}><span className="quick-icon blue"><Zap/></span><div><strong>Revisar</strong><small>Flashcards do seu nível</small></div><ChevronRight/></button>
          </div>
        </div>
        <aside className="side-column">
          <div className="goal-card"><div className="card-title"><Target/><strong>Meta mensal</strong><span>{monthName}</span></div><ProgressRing value={monthlyPercent} label="concluído"/><p><strong>{metrics.activitiesThisMonth}</strong> de {monthlyTarget} atividades</p><small>{monthlyPercent >= 100 ? "Meta concluída!" : "Cada atividade concluída conta."}</small></div>
          <div className="review-card"><div className="card-title"><Zap/><strong>Progresso diário</strong></div><h3>{metrics.completedToday ? `${metrics.completedToday} ${metrics.completedToday === 1 ? "atividade concluída" : "atividades concluídas"}` : "Comece sua primeira atividade"}</h3><p>Leituras, exercícios, flashcards e conversas atualizam este card automaticamente.</p><Button variant="secondary" full onClick={() => go("learn")}>{metrics.completedToday ? "Continuar estudando" : "Começar agora"}</Button></div>
        </aside>
      </section>
    </div>
  );
}

const weekdayNames = ["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"];

/**
 * O plano adaptativo é a Fase 9 do roadmap. Até lá esta tela mostra apenas o que
 * é verificável: a rotina escolhida pelo aluno, os dias em que ele realmente
 * estudou nesta semana e a próxima conversa sugerida. Nenhuma métrica inventada.
 */
function Plan({ go, displayName, preferences, session, scenarios, startScenario }: { go: (id: ScreenId) => void; displayName: string; preferences: LearnerPreferences | null; session: Session | null; scenarios: ScenarioCatalogItem[]; startScenario: (scenario: ScenarioCatalogItem) => void }) {
  const [metrics, setMetrics] = useState(() => calculateDashboardMetrics([], preferences?.studyDaysPerWeek || 5));
  const [loading, setLoading] = useState(Boolean(session));
  const recommended = recommendScenario(scenarios, preferences?.currentLevel || "unknown", preferences || undefined);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      const [learningResult, conversationResult] = await Promise.all([
        supabase.from("learning_activity_events").select("completed_at").eq("user_id", session.user.id),
        supabase
          .from("conversation_sessions")
          .select("started_at")
          .eq("user_id", session.user.id)
          .gt("learner_message_count", 0),
      ]);
      if (!active) return;
      setMetrics(calculateDashboardMetrics([
        ...(learningResult.data || []).map(({ completed_at }) => completed_at),
        ...(conversationResult.data || []).map(({ started_at }) => started_at),
      ], preferences?.studyDaysPerWeek || 5));
      setLoading(false);
    };
    void load();
    return () => { active = false; };
  }, [preferences?.studyDaysPerWeek, session]);

  const monday = new Date();
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const todayIndex = (new Date().getDay() + 6) % 7;

  return (
    <div className="screen-content">
      <AppHeader title="Sua rotina de estudo" subtitle="O que você definiu e o que já cumpriu nesta semana." displayName={displayName} onNavigate={go}/>
      <div className="plan-overview">
        <div><span className="eyebrow">SEU OBJETIVO</span><h2>{preferences ? goalLabels[preferences.learningGoal] : "Conversação"}</h2><p>{preferences ? levelLabels[preferences.currentLevel] : "Nível inicial"} · {preferences?.studyMinutesPerDay || 20} minutos por dia · {metrics.weeklyTarget} {metrics.weeklyTarget === 1 ? "dia" : "dias"} por semana.</p></div>
        <div className="plan-progress"><strong>{loading ? "…" : `${metrics.weeklyPercent}%`}</strong><div><i style={{ width: `${metrics.weeklyPercent}%` }}/></div><span>{metrics.activeDaysThisWeek} de {metrics.weeklyTarget} dias nesta semana</span></div>
        <button onClick={() => go("profile")}><Settings size={18}/> Ajustar rotina</button>
      </div>
      <div className="week-layout">
        <section className="week-list">
          <div className="section-heading compact"><h2>Esta semana</h2><span>{loading ? "carregando…" : `${metrics.activeDaysThisWeek} ${metrics.activeDaysThisWeek === 1 ? "dia estudado" : "dias estudados"}`}</span></div>
          {weekdayNames.map((label, index) => {
            const date = new Date(monday);
            date.setDate(monday.getDate() + index);
            const studied = metrics.activeWeekdays[index];
            const isToday = index === todayIndex;
            return (
              <article key={label} className={`day-row${isToday ? " active" : ""}${studied ? " complete" : ""}`}>
                <div className="date-block"><span>{label}</span><strong>{date.getDate()}</strong></div>
                <span className="timeline-dot">{studied ? <Check size={16}/> : isToday ? <Play size={15}/> : ""}</span>
                <div className="day-copy"><span>{studied ? "Concluído" : isToday ? "Hoje" : "Sem registro"}</span><h3>{studied ? "Você estudou neste dia" : isToday ? "Ainda dá tempo hoje" : "Nenhuma atividade registrada"}</h3><small><Clock3 size={14}/> meta de {preferences?.studyMinutesPerDay || 20} min</small></div>
                {isToday && recommended ? <Button onClick={() => startScenario(recommended)}>Conversar</Button> : <button className="more-button" disabled title="Registro apenas informativo">•••</button>}
              </article>
            );
          })}
        </section>
        <aside className="plan-aside">
          <div className="insight-card"><Sparkles/><span>PRÓXIMO PASSO</span><h3>{recommended ? recommended.title : "Escolha um cenário"}</h3><p>{recommended ? recommended.objective : "O catálogo de conversas não pôde ser carregado."}</p>{recommended && <Button variant="secondary" full onClick={() => startScenario(recommended)}>Começar agora</Button>}</div>
          <div className="month-card"><h3>Como esta tela funciona</h3><div><span>01</span><p><strong>Rotina definida por você</strong><small>Ajuste dias e minutos no perfil.</small></p></div><div><span>02</span><p><strong>Dias marcados por atividade real</strong><small>Lições, exercícios e conversas contam.</small></p></div><div><span>03</span><p><strong>Plano adaptativo em construção</strong><small>Tarefas geradas pelo tutor virão em uma etapa futura.</small></p></div></div>
        </aside>
      </div>
    </div>
  );
}

function Scenarios({
  displayName,
  preferences,
  scenarios,
  catalogError,
  reloadCatalog,
  selectScenario,
  go,
}: {
  displayName: string;
  preferences: LearnerPreferences | null;
  scenarios: ScenarioCatalogItem[];
  catalogError: string;
  reloadCatalog: () => void;
  selectScenario: (scenario: ScenarioCatalogItem) => void;
  go: (id: ScreenId) => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | ScenarioCatalogItem["category"]>("all");
  const normalized = query.trim().toLocaleLowerCase("pt-BR");
  const visibleScenarios = scenarios.filter((scenario) =>
    (category === "all" || scenario.category === category)
    && `${scenario.title} ${scenario.description}`.toLocaleLowerCase("pt-BR").includes(normalized)
  );
  const recommended = recommendScenario(scenarios, preferences?.currentLevel || "unknown", preferences || undefined);

  if (catalogError) {
    return (
      <div className="screen-content">
        <AppHeader title="Escolha uma conversa" displayName={displayName} onNavigate={go}/>
        <div className="learning-loading"><MessageCircle/><p>{catalogError}</p><Button onClick={reloadCatalog}>Tentar novamente</Button></div>
      </div>
    );
  }

  if (!scenarios.length) {
    return (
      <div className="screen-content">
        <AppHeader title="Escolha uma conversa" displayName={displayName} onNavigate={go}/>
        <div className="learning-loading"><Sparkles/><p>Carregando os cenários...</p></div>
      </div>
    );
  }

  return (
    <div className="screen-content">
      <AppHeader title="Escolha uma conversa" subtitle="Pratique situações que fazem parte da sua vida." displayName={displayName} onNavigate={go}/>
      <div className="filter-row">
        <div className="search-box"><Search size={18}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar cenário..."/></div>
        <div className="filter-pills">
          {([["all", "Todos"], ["daily", "Cotidiano"], ["professional", "Profissional"], ["travel", "Viagem"]] as const).map(([value, label]) => (
            <button key={value} className={category === value ? "active" : ""} onClick={() => setCategory(value)}>{label}</button>
          ))}
        </div>
      </div>
      {recommended && (
        <div className="featured-scenario">
          <div><span className="eyebrow light">RECOMENDADO PARA VOCÊ</span><h2>{recommended.title}</h2><p>{recommended.objective}</p><div><span><Clock3 size={16}/> {recommended.plannedMinutes} min</span><span><Target size={16}/> {levelRange(recommended.minLevel, recommended.maxLevel)}</span></div><Button onClick={() => selectScenario(recommended)} variant="secondary" icon={<ArrowRight size={17}/>}>Começar</Button></div>
          <div className="challenge-art"><div className="speech-orb"><MessageCircle/></div><span>{recommended.plannedMinutes}:00</span></div>
        </div>
      )}
      <div className="scenario-grid">
        {visibleScenarios.map((scenario) => (
            <button key={scenario.id} className="scenario-card" onClick={() => selectScenario(scenario)}>
              <span className={`scenario-art ${scenario.accent}`}>{renderScenarioIcon(scenario.icon)}</span>
              <div>
                <span className="level-chip">{levelRange(scenario.minLevel, scenario.maxLevel)}</span>
                <h3>{scenario.title}</h3>
                <p>{scenario.description}</p>
                <div className="scenario-meta"><span><Clock3 size={14}/>{scenario.plannedMinutes} min</span><span>{categoryLabels[scenario.category]}</span><span>Começar <ArrowRight size={15}/></span></div>
              </div>
            </button>
        ))}
      </div>
      {visibleScenarios.length === 0 && <p className="form-message">Nenhum cenário encontrado.</p>}
      <p className="scenario-footnote">Você tem três conversas por dia. Retomar uma conversa aberta não consome uma nova.</p>
    </div>
  );
}

function Assessment({ displayName, preferences }: { displayName: string; preferences: LearnerPreferences | null }) {
  return (
    <div className="screen-content assessment-screen">
      <AppHeader title="Descubra seu nível" subtitle="Uma avaliação curta para personalizar seu plano." displayName={displayName}/>
      <div className="assessment-intro">
        <div className="assessment-copy"><span className="eyebrow light">AVALIAÇÃO OPCIONAL</span><h2>Entenda onde você está — sem pressão.</h2><p>Vamos avaliar compreensão, vocabulário e escrita. O resultado é uma estimativa, não uma certificação.</p><div className="assessment-meta"><span><Clock3/> 8–10 minutos</span><span><Target/> 18 questões</span><span><ShieldCheck/> Resultado privado</span></div><Button variant="secondary" disabled>Avaliação em breve</Button></div>
        <div className="level-scale"><span>A1<small>Iniciante</small></span><span className="active">A2<small>Básico</small></span><span>B1<small>Intermediário</small></span><span>B2<small>Independente</small></span></div>
      </div>
      <section className="assessment-details"><h2>Como funciona</h2><div><article><span>01</span><BookOpen/><h3>Compreensão</h3><p>Leia situações curtas e escolha a interpretação mais adequada.</p></article><article><span>02</span><Languages/><h3>Uso do idioma</h3><p>Complete frases e mostre como usaria o inglês no cotidiano.</p></article><article><span>03</span><WandSparkles/><h3>Resultado explicado</h3><p>Veja evidências do seu nível e recomendações para avançar.</p></article></div></section>
      <div className="sample-question"><div><span>EXEMPLO DE QUESTÃO</span><strong>Choose the best response:</strong><p>“Would you like anything else?”</p></div><div><button disabled>A. Yes, I like.</button><button disabled className="correct">B. No, that’s all. Thank you. <Check/></button><button disabled>C. I don’t have.</button></div></div>
    </div>
  );
}

type ProgressPeriod = 7 | 30 | 90 | 0;
type LearningProgressRow = {
  activity_type: string;
  score: number;
  completed_at: string;
};

function Progress({ displayName, preferences, session }: { displayName: string; preferences: LearnerPreferences | null; session: Session | null }) {
  const [period, setPeriod] = useState<ProgressPeriod>(30);
  const [activities, setActivities] = useState<LearningProgressRow[]>([]);
  const [tutorInteractions, setTutorInteractions] = useState<string[]>([]);
  const [loading, setLoading] = useState(Boolean(session));
  const [progressError, setProgressError] = useState("");

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) return;
    let active = true;
    const loadProgress = async () => {
      setLoading(true);
      setProgressError("");
      const [learningResult, tutorResult] = await Promise.all([
        supabase
          .from("learning_activity_events")
          .select("activity_type,score,completed_at")
          .eq("user_id", session.user.id)
          .order("completed_at"),
        supabase
          .from("conversation_messages")
          .select("created_at")
          .eq("user_id", session.user.id)
          .eq("role", "learner")
          .order("created_at"),
      ]);
      if (!active) return;
      if (learningResult.error || tutorResult.error) {
        setProgressError("Não foi possível carregar todo o seu progresso.");
      }
      setActivities((learningResult.data || []) as LearningProgressRow[]);
      setTutorInteractions((tutorResult.data || []).map((item) => item.created_at));
      setLoading(false);
    };
    void loadProgress();
    return () => { active = false; };
  }, [session]);

  const now = new Date();
  const cutoff = period
    ? new Date(now.getTime() - period * 24 * 60 * 60 * 1000)
    : null;
  const inPeriod = (timestamp: string) => !cutoff || new Date(timestamp) >= cutoff;
  const visibleActivities = activities.filter((item) => inPeriod(item.completed_at));
  const visibleInteractions = tutorInteractions.filter(inPeriod);
  const allTimestamps = [...activities.map((item) => item.completed_at), ...tutorInteractions];
  const dashboardMetrics = calculateDashboardMetrics(
    allTimestamps,
    preferences?.studyDaysPerWeek || 5,
  );
  const reviewAttempts = visibleActivities
    .filter((item) => item.activity_type === "review" || item.activity_type === "flashcard")
    .length;
  const estimatedMinutes = visibleActivities.length * 5
    + visibleInteractions.length * 2;
  const skillDefinitions = [
    ["Lições rápidas", ["quick_lesson"]],
    ["Revisão", ["review", "flashcard"]],
    ["Gramática", ["grammar"]],
    ["Compreensão", ["reading"]],
  ] as const;
  const skills = skillDefinitions.map(([label, types]) => {
    const rows = visibleActivities.filter((item) => (types as readonly string[]).includes(item.activity_type));
    const score = rows.length
      ? Math.round(rows.reduce((total, item) => total + item.score, 0) / rows.length)
      : 0;
    return { label, score, count: rows.length };
  });
  const chartDays = period || Math.max(
    30,
    Math.ceil((now.getTime() - Math.min(
      now.getTime(),
      ...allTimestamps.map((timestamp) => new Date(timestamp).getTime()),
    )) / 86_400_000),
  );
  const bucketCount = Math.min(12, chartDays);
  const bucketSize = Math.max(1, Math.ceil(chartDays / bucketCount));
  const chartValues = Array.from({ length: bucketCount }, (_, index) => {
    const bucketEndDaysAgo = (bucketCount - index - 1) * bucketSize;
    const bucketStartDaysAgo = bucketEndDaysAgo + bucketSize;
    const bucketStart = new Date(now.getTime() - bucketStartDaysAgo * 86_400_000);
    const bucketEnd = new Date(now.getTime() - bucketEndDaysAgo * 86_400_000);
    const count = [
      ...visibleActivities.map((item) => item.completed_at),
      ...visibleInteractions,
    ].filter((timestamp) => {
      const date = new Date(timestamp);
      return date >= bucketStart && date < bucketEnd;
    }).length;
    return { count, label: index % 2 === 0 ? `${bucketStart.getDate()}/${bucketStart.getMonth() + 1}` : "" };
  });
  const maxChartValue = Math.max(1, ...chartValues.map((item) => item.count));

  return (
    <div className="screen-content">
      <AppHeader title="Seu progresso" subtitle="Evidências reais do que você vem construindo." displayName={displayName}/>
      <div className="period-tabs">{([[7, "7 dias"], [30, "30 dias"], [90, "3 meses"], [0, "Todo período"]] as Array<[ProgressPeriod, string]>).map(([value, label]) => <button key={value} className={period === value ? "active" : ""} onClick={() => setPeriod(value)}>{label}</button>)}</div>
      {progressError && <div className="form-message form-error" role="alert">{progressError}</div>}
      <div className="stats-grid">
        <Stat icon={<Clock3/>} value={loading ? "…" : `${Math.floor(estimatedMinutes / 60)}h ${estimatedMinutes % 60}min`} label="tempo estimado de estudo" tone="teal"/>
        <Stat icon={<CheckCircle2/>} value={loading ? "…" : String(visibleActivities.length)} label="atividades concluídas" tone="coral"/>
        <Stat icon={<MessageCircle/>} value={loading ? "…" : String(visibleInteractions.length)} label="interações com o tutor" tone="blue"/>
        <Stat icon={<Flame/>} value={loading ? "…" : `${dashboardMetrics.streak} ${dashboardMetrics.streak === 1 ? "dia" : "dias"}`} label="sequência atual" tone="amber"/>
      </div>
      <div className="analytics-grid">
        <section className="chart-card">
          <div className="section-heading compact"><div><span className="eyebrow">ATIVIDADE REAL</span><h2>Atividades por período</h2></div><span className="trend">{visibleActivities.length + visibleInteractions.length} registros</span></div>
          <div className="bar-chart">{chartValues.map((item,index)=><div key={index} title={`${item.count} atividades`}><i style={{height:`${Math.max(item.count ? 8 : 0, Math.round((item.count / maxChartValue) * 100))}%`}}/><span>{item.label}</span></div>)}</div>
        </section>
        <section className="skills-card"><span className="eyebrow">DESEMPENHO</span><h2>{preferences ? languageDetails[preferences.targetLanguage].name : "Idioma estudado"}</h2>{skills.map((skill)=><div key={skill.label}><span>{skill.label}<strong>{skill.count ? `${skill.score}%` : "—"}</strong></span><i><b style={{width:`${skill.score}%`}}/></i></div>)}<small>Médias calculadas somente com respostas registradas no período.</small></section>
      </div>
      <div className="progress-bottom">
        <section className="milestones"><div className="section-heading compact"><h2>Marcos atuais</h2></div><div><span><Trophy/></span><p><strong>{visibleActivities.length} atividades concluídas</strong><small>No período selecionado</small></p></div><div><span><MessageCircle/></span><p><strong>{visibleInteractions.length} interações com o tutor</strong><small>Respostas de IA concluídas</small></p></div><div><span><BookOpen/></span><p><strong>{reviewAttempts} cartões revisados</strong><small>Tentativas de revisão registradas</small></p></div></section>
        <section className="error-insights"><div className="section-heading compact"><h2>Distribuição das atividades</h2></div>{skills.map((skill) => <p key={skill.label}><span>{skill.label}</span><strong>{skill.count}</strong></p>)}<small>Os números refletem somente atividades persistidas no Supabase.</small></section>
      </div>
    </div>
  );
}

function Profile({
  go,
  displayName,
  email,
  saveSettings,
  session,
}: {
  go: (id: ScreenId) => void;
  displayName: string;
  email: string;
  saveSettings: (name: string, preferences: LearnerPreferences) => Promise<AuthFeedback>;
  session: Session | null;
}) {
  const { preferences, studiedLanguages, isAdmin, goToPricing, switchLanguage, addLanguage } = useLearner();
  const [section, setSection] = useState<"profile" | "languages" | "plan" | "billing" | "notifications">("profile");
  const [name, setName] = useState(displayName);
  const [draft, setDraft] = useState<LearnerPreferences>(preferences || {
    targetLanguage: "en",
    currentLevel: "unknown",
    learningGoal: "conversation",
    studyMinutesPerDay: 20,
    studyDaysPerWeek: 5,
    correctionPreference: "immediate",
    interests: [],
    desiredScenarios: [],
  });
  const [levelEdits, setLevelEdits] = useState<
    Partial<Record<TargetLanguage, LearnerPreferences["currentLevel"]>>
  >({});
  const [newLanguage, setNewLanguage] = useState<TargetLanguage | "">("");
  const [feedback, setFeedback] = useState<AuthFeedback>({});
  const [saving, setSaving] = useState(false);
  const [entitlements, setEntitlements] = useState<EntitlementsSummary | null>(null);
  const [entitlementsLoading, setEntitlementsLoading] = useState(false);
  const [entitlementsError, setEntitlementsError] = useState("");

  const accessToken = session?.access_token;

  const reloadEntitlements = async () => {
    if (!accessToken) return;
    try {
      setEntitlements(await loadEntitlements(accessToken));
    } catch {
      setEntitlementsError("Não foi possível atualizar o plano.");
    }
  };

  const resolvedLanguageLevels = studiedLanguages.map((entry) => ({
    ...entry,
    currentLevel: levelEdits[entry.targetLanguage] ?? entry.currentLevel,
  }));

  const studiedSet = new Set(studiedLanguages.map((entry) => entry.targetLanguage));
  const availableLanguages = (Object.keys(languageDetails) as TargetLanguage[]).filter(
    (language) => !studiedSet.has(language),
  );

  useEffect(() => {
    if (!session?.access_token || section !== "plan") return;
    let active = true;
    const load = async () => {
      setEntitlementsError("");
      setEntitlementsLoading(true);
      try {
        const summary = await loadEntitlements(session.access_token);
        if (active) setEntitlements(summary);
      } catch {
        if (active) setEntitlementsError("Não foi possível carregar o uso do seu plano.");
      } finally {
        if (active) setEntitlementsLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [section, session?.access_token]);

  const save = async () => {
    setSaving(true);
    const supabase = getSupabaseBrowserClient();
    if (supabase && session) {
      for (const entry of resolvedLanguageLevels) {
        const previous = studiedLanguages.find((item) => item.targetLanguage === entry.targetLanguage);
        if (!previous || entry.currentLevel === previous.currentLevel) continue;
        const { error } = await supabase.rpc("update_learner_language_level", {
          p_target_language: entry.targetLanguage,
          p_current_level: entry.currentLevel,
        });
        if (error) {
          setSaving(false);
          setFeedback({ error: "Não foi possível atualizar o nível de um dos idiomas." });
          return;
        }
      }
    }

    const activeLevel =
      resolvedLanguageLevels.find((entry) => entry.targetLanguage === draft.targetLanguage)?.currentLevel
      || draft.currentLevel;
    setFeedback(await saveSettings(name, { ...draft, currentLevel: activeLevel }));
    setSaving(false);
  };

  const addStudiedLanguage = async () => {
    if (!newLanguage) return;
    setSaving(true);
    const result = await addLanguage(newLanguage, "unknown");
    if (result.error) {
      setFeedback({ error: result.error });
      setSaving(false);
      return;
    }
    const switched = await switchLanguage(newLanguage);
    setFeedback(switched.error ? { error: switched.error } : { success: `${languageDetails[newLanguage].name} adicionado.` });
    setNewLanguage("");
    setSaving(false);
  };

  return (
    <div className="screen-content">
      <AppHeader title="Perfil e preferências" subtitle="Ajuste como o Lume ensina você." displayName={displayName} onNavigate={go}/>
      <div className="settings-layout">
        <aside className="settings-nav">
          <button className={section === "profile" ? "active" : ""} onClick={() => setSection("profile")}><CircleUserRound/> Perfil</button>
          <button className={section === "languages" ? "active" : ""} onClick={() => setSection("languages")}><Languages/> Idiomas</button>
          <button className={section === "plan" ? "active" : ""} onClick={() => setSection("plan")}><Target/> Plano e metas</button>
          <button className={section === "billing" ? "active" : ""} onClick={() => setSection("billing")}><CreditCard/> Pagamentos</button>
          <button className={section === "notifications" ? "active" : ""} onClick={() => setSection("notifications")}><Bell/> Notificações</button>
          {isAdmin && (
            <button type="button" className="settings-admin-link" onClick={() => go("admin")}>
              <ShieldCheck aria-hidden="true" focusable="false" /> Administração
            </button>
          )}
          <button onClick={() => go("privacy")}><LockKeyhole aria-hidden="true" focusable="false" /> Dados e privacidade</button>
        </aside>
        <main className="settings-panel">
          {section === "profile" && <>
            <section><div className="profile-heading"><div className="large-avatar">{name.slice(0, 2).toUpperCase()}</div><div><h2>{name || "Aluno"}</h2><p>Minha aprendizagem</p></div></div></section>
            <section><h3>Informações pessoais</h3><div className="form-grid"><label>Nome<input maxLength={100} value={name} onChange={(event) => setName(event.target.value)}/></label><label>Email<input value={email} readOnly/></label></div></section>
          </>}
          {section === "languages" && <section><h3>Idiomas que você estuda</h3><p>Use a bandeira no topo da tela para trocar rapidamente. Ajuste o nível de cada idioma aqui.</p><div className="language-cards">
            {resolvedLanguageLevels.map((entry) => {
              const details = languageDetails[entry.targetLanguage];
              const active = preferences?.targetLanguage === entry.targetLanguage;
              return (
                <article key={entry.targetLanguage} className={`language-card${active ? " active" : ""}`}>
                  <div className="language-card-title"><span className="language-card-flag" aria-hidden="true">{details.flag}</span><div><strong>{details.name}</strong>{active && <span className="language-card-badge">Ativo agora</span>}</div></div>
                  <label>Nível<select value={entry.currentLevel} onChange={(event) => setLevelEdits((current) => ({ ...current, [entry.targetLanguage]: event.target.value as LearnerPreferences["currentLevel"] }))}>{selectableLevels.map((value) => <option key={value} value={value}>{levelLabels[value]}</option>)}</select></label>
                  {!active && <Button variant="secondary" onClick={() => void switchLanguage(entry.targetLanguage)}>Usar agora</Button>}
                </article>
              );
            })}
          </div>
          {availableLanguages.length > 0 && <div className="language-card-add"><label>Adicionar outro idioma<select value={newLanguage} onChange={(event) => setNewLanguage(event.target.value as TargetLanguage)}><option value="">Selecione</option>{availableLanguages.map((language) => <option key={language} value={language}>{languageDetails[language].flag} {languageDetails[language].name}</option>)}</select></label><Button variant="secondary" disabled={!newLanguage || saving} onClick={() => void addStudiedLanguage()}>Adicionar idioma</Button></div>}
          </section>}
          {section === "plan" && <section><h3>Plano e metas</h3>
            {(entitlementsLoading || entitlements) && (
              <div className="usage-grid" aria-label="Uso diário do plano" aria-busy={entitlementsLoading}>
                {entitlementsLoading ? (
                  Array.from({ length: 4 }, (_, index) => (
                    <article key={index} className="usage-card usage-card-skeleton">
                      <span className="usage-skeleton-line usage-skeleton-label" />
                      <strong className="usage-skeleton-line usage-skeleton-value" />
                    </article>
                  ))
                ) : entitlements ? (
                  <>
                    <article className="usage-card">
                      <span>Plano atual</span>
                      <strong>{planLabel(entitlements.plan_id)}</strong>
                    </article>
                    <article className="usage-card">
                      <span>Conversas hoje</span>
                      <strong>{entitlements.usage.conversation_sessions.used} / {entitlements.usage.conversation_sessions.limit}</strong>
                    </article>
                    <article className="usage-card">
                      <span title="Cada resposta do tutor, correção ou atividade de estudo conta como uma chamada.">Chamadas de IA</span>
                      <strong>{entitlements.usage.llm_requests.used} / {entitlements.usage.llm_requests.limit}</strong>
                    </article>
                    <article className="usage-card">
                      <span>Transcrições hoje</span>
                      <strong>{entitlements.usage.transcriptions.used} / {entitlements.usage.transcriptions.limit}</strong>
                    </article>
                  </>
                ) : null}
              </div>
            )}
            {!entitlementsLoading && entitlements && (
              <p className="usage-note">Chamadas de IA incluem respostas do tutor, correções e exercícios. Os limites são redefinidos todo dia.</p>
            )}
            {!entitlementsLoading && (
              <Button variant="secondary" onClick={() => setSection("billing")}>
                Ver pagamentos e assinatura
              </Button>
            )}
            {!entitlementsLoading && entitlements?.plan_id === "free" && (
              <UpgradePrompt
                title="Pratique sem travar no limite"
                message="Premium é para quem quer estudar todo dia com conversas longas e muito mais prática por voz."
                onUpgrade={goToPricing}
                ctaLabel="Assinar Premium"
                highlights={UPGRADE_HIGHLIGHTS}
              />
            )}
            {entitlements && !entitlementsLoading && entitlements.plan_id === "free" && (
              <PlanComparison variant="compact" currentPlan="free" highlightColumn="premium" />
            )}
            {entitlements && isNearLimit(entitlements.usage.conversation_sessions.used, entitlements.usage.conversation_sessions.limit) && entitlements.plan_id === "free" && (
              <UpgradePrompt
                compact
                title="Você está perto do limite diário"
                message={`Hoje: ${entitlements.usage.conversation_sessions.used}/${entitlements.usage.conversation_sessions.limit} conversas.`}
                onUpgrade={goToPricing}
                ctaLabel="Liberar mais conversas"
              />
            )}
            {entitlementsError && <div className="form-message form-error" role="alert">{entitlementsError}</div>}
            <div className="form-grid">
            <label>Objetivo principal<select value={draft.learningGoal} onChange={(event) => setDraft({...draft, learningGoal: event.target.value as OnboardingData["learningGoal"]})}>{Object.entries(goalLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Minutos por dia<select value={draft.studyMinutesPerDay} onChange={(event) => setDraft({...draft, studyMinutesPerDay: Number(event.target.value) as OnboardingData["studyMinutesPerDay"]})}>{[10,20,30,60].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutos</option>)}</select></label>
            <label>Dias por semana<select value={draft.studyDaysPerWeek} onChange={(event) => setDraft({...draft, studyDaysPerWeek: Number(event.target.value)})}>{[1,2,3,4,5,6,7].map((days) => <option key={days} value={days}>{days} {days === 1 ? "dia" : "dias"}</option>)}</select></label>
            <label>Correções<select value={draft.correctionPreference} onChange={(event) => setDraft({...draft, correctionPreference: event.target.value as OnboardingData["correctionPreference"]})}><option value="immediate">Durante a conversa</option><option value="grouped">Em pequenos grupos</option><option value="final">Somente ao final</option></select></label>
          </div></section>}
          {section === "billing" && (
            <BillingAccountPanel
              session={session}
              onGoToPricing={goToPricing}
              onSubscriptionChanged={reloadEntitlements}
            />
          )}
          {section === "notifications" && <section><h3>Notificações</h3><p>Os lembretes ainda não são enviados. Essa opção será ativada quando o serviço de notificações estiver disponível.</p></section>}
          {feedback.error && <div className="form-message form-error" role="alert">{feedback.error}</div>}
          {feedback.success && <div className="form-message form-success" role="status">{feedback.success}</div>}
          {section !== "notifications" && section !== "billing" && <div className="save-row"><Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar alterações"}</Button></div>}
        </main>
      </div>
    </div>
  );
}

function Privacy({
  session,
  accountDeleted,
}: {
  session: Session | null;
  accountDeleted: () => Promise<void>;
}) {
  const [confirmingDeletion, setConfirmingDeletion] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deletionError, setDeletionError] = useState("");
  const apiUrl = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "");

  const deleteAccount = async () => {
    if (confirmation !== "EXCLUIR" || deleting) return;
    if (!apiUrl) {
      setDeletionError("A URL do backend ainda não foi configurada.");
      return;
    }
    if (!session?.access_token) {
      setDeletionError("Sua sessão expirou. Entre novamente antes de excluir a conta.");
      return;
    }

    setDeleting(true);
    setDeletionError("");
    try {
      const response = await fetch(`${apiUrl}/api/v1/account`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ confirmation: "EXCLUIR" }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(
          typeof payload?.detail === "string"
            ? payload.detail
            : "Não foi possível excluir sua conta. Tente novamente.",
        );
      }
      await accountDeleted();
    } catch (requestError) {
      setDeletionError(
        requestError instanceof Error
          ? requestError.message
          : "Não foi possível excluir sua conta. Tente novamente.",
      );
      setDeleting(false);
    }
  };

  const cancelDeletion = () => {
    setConfirmingDeletion(false);
    setConfirmation("");
    setDeletionError("");
  };

  return (
    <div className="screen-content">
      <AppHeader title="Dados e privacidade" subtitle="Você controla o que guardamos sobre sua aprendizagem."/>
      <div className="privacy-layout">
        <main>
          <div className="privacy-principle"><ShieldCheck/><div><span className="eyebrow">NOSSO PRINCÍPIO</span><h2>Seus dados existem para ajudar você — e continuam sendo seus.</h2><p>O Lume não armazena o arquivo de áudio após a transcrição. Você pode baixar ou excluir seus dados a qualquer momento.</p></div></div>
          <section className="data-section"><h2>Seus dados</h2><article><span className="data-icon"><MessageCircle/></span><div><strong>Conversas e correções</strong><p>Persistidas para compor seu histórico e seus resumos.</p><small className="safe"><CheckCircle2/> Protegidas por usuário com RLS</small></div></article><article><span className="data-icon"><WandSparkles/></span><div><strong>Memórias do tutor</strong><p>Objetivos, preferências e dificuldades que você autorizou.</p><small>Memória de longo prazo ainda não ativada</small></div><button disabled>Visualizar</button></article><article><span className="data-icon"><Mic2/></span><div><strong>Escrita por voz</strong><p>Com sua autorização, o áudio é enviado autenticado ao Google Gemini somente para gerar a transcrição. O Google atua como processador externo sujeito aos termos do serviço.</p><small className="safe"><CheckCircle2/> O arquivo de áudio não é armazenado pelo Lume</small></div></article></section>
          <section className="export-section"><div><Download/><div><h3>Baixe uma cópia dos seus dados</h3><p>A exportação será implementada junto ao backend.</p></div><Button variant="secondary" disabled>Exportação em breve</Button></div></section>
          <section className="danger-zone">
            <h2>Excluir conta</h2>
            <p>Exclui permanentemente seu acesso, perfil, preferências e histórico de aprendizagem. Esta ação não pode ser desfeita.</p>
            {!confirmingDeletion && <Button variant="danger" onClick={() => setConfirmingDeletion(true)} icon={<Trash2 size={17}/>}>Excluir minha conta</Button>}
            {confirmingDeletion && (
              <div className="account-delete-confirmation">
                <strong>Confirme a exclusão permanente</strong>
                <label>Digite <b>EXCLUIR</b> para continuar<input autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={deleting}/></label>
                {deletionError && <div className="form-message form-error" role="alert">{deletionError}</div>}
                <div>
                  <Button variant="secondary" onClick={cancelDeletion} disabled={deleting}>Cancelar</Button>
                  <Button variant="danger" onClick={deleteAccount} disabled={confirmation !== "EXCLUIR" || deleting} icon={<Trash2 size={17}/>}>{deleting ? "Excluindo..." : "Excluir permanentemente"}</Button>
                </div>
              </div>
            )}
          </section>
        </main>
        <aside><div className="privacy-summary"><h3>Resumo de privacidade</h3><p><Check/> Áudio não armazenado</p><p><Check/> Dados protegidos por usuário</p><p><Check/> Sem venda de dados pessoais</p><button disabled>Política completa em preparação</button></div><div className="session-card"><LockKeyhole/><h3>Sessão atual</h3><p>Você está conectado neste dispositivo.</p><button disabled>Gerenciamento em breve</button></div></aside>
      </div>
    </div>
  );
}

type LearningMode = "summary" | "quick_lesson" | "reading" | "grammar" | "review";
type GrammarView = "explanations" | "exercises";

function LearningCenter({
  displayName,
  preferences,
  session,
  initialMode = "summary",
  goToScenarios,
}: {
  displayName: string;
  preferences: LearnerPreferences | null;
  session: Session | null;
  initialMode?: LearningMode;
  goToScenarios: () => void;
}) {
  const { planId, goToPricing } = useLearner();
  const language = preferences?.targetLanguage || "en";
  const preferredLevel = (["A1", "A2", "B1", "B2"].includes(preferences?.currentLevel || "")
    ? preferences?.currentLevel
    : "A1") as LearningLevel;
  const catalogClient = getSupabaseBrowserClient();
  const [learningContent, setLearningContent] = useState<LearningContent | null>(null);
  const [contentError, setContentError] = useState(
    catalogClient ? "" : "A conexão com o catálogo ainda não está configurada.",
  );
  const [contentVersion, setContentVersion] = useState(0);
  const learning = learningContent || {
    quickLessons: [],
    readings: [],
    grammarTopics: [],
    grammarExercises: [],
    flashcards: [],
  };
  const [mode, setMode] = useState<LearningMode>(initialMode);
  const reviewOnly = mode === "review";
  const [level, setLevel] = useState<LearningLevel>(preferredLevel);
  const [activityIndex, setActivityIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [cardIndex, setCardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [quickLessonAnswers, setQuickLessonAnswers] = useState<Record<number, number>>({});
  const [readingAnswers, setReadingAnswers] = useState<Record<number, number>>({});
  const [grammarView, setGrammarView] = useState<GrammarView>("explanations");
  const [grammarExerciseIndex, setGrammarExerciseIndex] = useState(0);
  const [completedActivityIds, setCompletedActivityIds] = useState<Set<string>>(new Set());
  const [sectionProgress, setSectionProgress] = useState<LearningSectionProgress[]>([]);

  useEffect(() => {
    if (!catalogClient) return;
    let active = true;
    const load = async () => {
      setContentError("");
      try {
        const content = reviewOnly
          ? {
              quickLessons: [],
              readings: [],
              grammarTopics: [],
              grammarExercises: [],
              flashcards: await loadReviewItems(catalogClient, language),
            }
          : await loadLearningContent(catalogClient, language);
        const progress = session
          ? await loadLearnerLearningProgress(catalogClient, session.user.id)
          : { completedActivityIds: [], sections: [] };
        if (active) {
          setLearningContent(content);
          setCompletedActivityIds(new Set(progress.completedActivityIds));
          setSectionProgress(progress.sections);
        }
      } catch {
        if (active) setContentError("Não foi possível carregar as lições. Tente novamente.");
      }
    };
    void load();
    return () => { active = false; };
  }, [catalogClient, contentVersion, language, reviewOnly, session]);

  const quickLessonActivities = learning.quickLessons.filter((item) => item.level === level);
  const readingActivities = learning.readings.filter((item) => item.level === level);
  const grammarTopics = learning.grammarTopics.filter((item) => item.level === level);
  const quickLessonActivity = mode === "quick_lesson" ? quickLessonActivities[activityIndex] : null;
  const readingActivity = mode === "reading" ? readingActivities[activityIndex] : null;
  const grammarTopic = mode === "grammar" ? grammarTopics[activityIndex] : null;
  const grammarExercises = grammarTopic
    ? learning.grammarExercises.filter((item) => item.topicId === grammarTopic.id)
    : [];
  const grammarExercise = grammarExercises[grammarExerciseIndex];
  const activityCount = mode === "quick_lesson"
    ? quickLessonActivities.length
    : mode === "reading"
      ? readingActivities.length
      : grammarTopics.length;
  const completedQuickLessons = learning.quickLessons.filter(
    (item) => completedActivityIds.has(item.id),
  ).length;
  const completedReadings = learning.readings.filter(
    (item) => completedActivityIds.has(item.id),
  ).length;
  const completedGrammarTopics = learning.grammarTopics.filter((topic) => {
    const topicExercises = learning.grammarExercises.filter((exercise) => exercise.topicId === topic.id);
    return topicExercises.length > 0
      && topicExercises.every((exercise) => completedActivityIds.has(exercise.id));
  }).length;
  const grammarTopicComplete = Boolean(grammarExercises.length)
    && grammarExercises.every((exercise) => completedActivityIds.has(exercise.id));

  const sectionCursor = (section: LearningSection, cursorLevel = level) =>
    sectionProgress.find((item) =>
      item.language === language && item.section === section && item.level === cursorLevel);

  const saveSectionCursor = async (
    section: LearningSection,
    cursorLevel: LearningLevel,
    activityId: string,
    stepIndex = 0,
    correctAnswers = 0,
    view: LearningSectionProgress["view"] = "activity",
  ) => {
    if (!session) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    const { error } = await supabase.rpc("save_learning_section_progress", {
      p_language: language,
      p_section: section,
      p_level: cursorLevel,
      p_activity_id: activityId,
      p_step_index: stepIndex,
      p_correct_answers: correctAnswers,
      p_view: view,
    });
    if (error) return;
    setSectionProgress((current) => [
      ...current.filter((item) =>
        !(item.language === language && item.section === section && item.level === cursorLevel)),
      {
        language,
        section,
        level: cursorLevel,
        activityId,
        stepIndex,
        correctAnswers,
        view,
      },
    ]);
  };

  const firstIncompleteIndex = (items: Array<{ id: string }>) => {
    const index = items.findIndex((item) => !completedActivityIds.has(item.id));
    return index < 0 ? 0 : index;
  };

  const resumeSection = (section: LearningSection, cursorLevel: LearningLevel) => {
    const items = section === "quick_lesson"
      ? learning.quickLessons.filter((item) => item.level === cursorLevel)
      : section === "reading"
        ? learning.readings.filter((item) => item.level === cursorLevel)
        : learning.grammarTopics.filter((item) => item.level === cursorLevel);
    const cursor = sectionCursor(section, cursorLevel);
    const cursorIndex = cursor
      ? items.findIndex((item) => item.id === cursor.activityId)
      : -1;
    const cursorCompleted = cursor
      && section !== "grammar"
      && completedActivityIds.has(cursor.activityId);
    const nextIndex = cursorIndex >= 0 && !cursorCompleted
      ? cursorIndex
      : firstIncompleteIndex(items);
    const resumedTopic = section === "grammar" ? items[nextIndex] : null;
    const resumedExercises = resumedTopic
      ? learning.grammarExercises.filter((item) => item.topicId === resumedTopic.id)
      : [];
    const firstIncompleteExercise = resumedExercises.findIndex(
      (exercise) => !completedActivityIds.has(exercise.id),
    );
    const grammarStep = cursorIndex === nextIndex
      && cursor
      && !completedActivityIds.has(resumedExercises[cursor.stepIndex]?.id)
        ? cursor.stepIndex
        : Math.max(0, firstIncompleteExercise);
    setActivityIndex(nextIndex);
    setSelectedAnswer(null);
    setSaved(false);
    setQuickLessonAnswers({});
    setReadingAnswers({});
    setGrammarView(
      section === "grammar" && cursor?.view === "exercises" ? "exercises" : "explanations",
    );
    setGrammarExerciseIndex(section === "grammar" ? grammarStep : 0);
  };

  const recordProgress = async (activityId: string, activityType: LearningMode, score: number) => {
    if (!session) return;
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    const { error } = await supabase.rpc("record_learning_activity_progress", {
      p_activity_id: activityId,
      p_activity_type: activityType,
      p_score: score,
    });
    if (!error) {
      setSaved(true);
      setCompletedActivityIds((current) => new Set(current).add(activityId));
    }
  };

  const recordMistake = async (
    activityId: string,
    activityType: "quick_lesson" | "reading" | "grammar",
    stepIndex: number,
    selectedIndex: number,
  ) => {
    if (!catalogClient) return;
    await catalogClient.rpc("record_learning_mistake", {
      p_activity_id: activityId,
      p_activity_type: activityType,
      p_step_index: stepIndex,
      p_selected_answer_index: selectedIndex,
    });
  };

  const chooseMode = (nextMode: LearningMode) => {
    setMode(nextMode);
    setSelectedAnswer(null);
    setSaved(false);
    setCardIndex(0);
    setFlipped(false);
    setQuickLessonAnswers({});
    setReadingAnswers({});
    setGrammarView("explanations");
    setGrammarExerciseIndex(0);
    if (nextMode === "quick_lesson" || nextMode === "reading" || nextMode === "grammar") {
      resumeSection(nextMode, level);
    } else {
      setActivityIndex(0);
    }
  };

  const openCatalogItem = (
    nextMode: Exclude<LearningMode, "summary" | "review">,
    nextLevel: LearningLevel,
    index: number,
  ) => {
    setMode(nextMode);
    setLevel(nextLevel);
    setActivityIndex(index);
    setSelectedAnswer(null);
    setSaved(false);
    setQuickLessonAnswers({});
    setReadingAnswers({});
    setGrammarView("explanations");
    setGrammarExerciseIndex(0);
    const items = nextMode === "quick_lesson"
      ? learning.quickLessons.filter((item) => item.level === nextLevel)
      : nextMode === "reading"
        ? learning.readings.filter((item) => item.level === nextLevel)
        : learning.grammarTopics.filter((item) => item.level === nextLevel);
    const activity = items[index];
    if (activity) void saveSectionCursor(nextMode, nextLevel, activity.id);
  };

  const chooseLevel = (nextLevel: LearningLevel) => {
    setLevel(nextLevel);
    if (mode === "quick_lesson" || mode === "reading" || mode === "grammar") {
      resumeSection(mode, nextLevel);
    } else {
      setActivityIndex(0);
    }
    setSelectedAnswer(null);
    setSaved(false);
    setQuickLessonAnswers({});
    setReadingAnswers({});
    setGrammarExerciseIndex(0);
  };

  const moveActivity = (direction: -1 | 1) => {
    setActivityIndex((current) => {
      const items = mode === "quick_lesson"
        ? quickLessonActivities
        : mode === "reading"
          ? readingActivities
          : grammarTopics;
      let next = current + direction;
      while (
        next >= 0
        && next < items.length
        && completedActivityIds.has(items[next].id)
      ) {
        next += direction;
      }
      const bounded = Math.max(0, Math.min(activityCount - 1, next));
      const activity = items[bounded];
      if (activity && (mode === "quick_lesson" || mode === "reading" || mode === "grammar")) {
        void saveSectionCursor(mode, level, activity.id);
      }
      return bounded;
    });
    setSelectedAnswer(null);
    setSaved(false);
    setQuickLessonAnswers({});
    setReadingAnswers({});
    setGrammarExerciseIndex(0);
  };

  const answerActivity = (questionIndex: number, optionIndex: number) => {
    if (!quickLessonActivity || quickLessonAnswers[questionIndex] !== undefined) return;
    const question = quickLessonActivity.questions[questionIndex];
    if (!question) return;

    const nextAnswers = { ...quickLessonAnswers, [questionIndex]: optionIndex };
    setQuickLessonAnswers(nextAnswers);

    if (optionIndex !== question.answer) {
      void recordMistake(quickLessonActivity.id, "quick_lesson", questionIndex, optionIndex);
    }

    const allAnswered = quickLessonActivity.questions.every(
      (_, index) => nextAnswers[index] !== undefined,
    );
    const correctAnswers = quickLessonActivity.questions.filter(
      (item, index) => nextAnswers[index] === item.answer,
    ).length;

    if (allAnswered) {
      const score = Math.round((correctAnswers / quickLessonActivity.questions.length) * 100);
      void recordProgress(quickLessonActivity.id, "quick_lesson", score);
    } else {
      void saveSectionCursor(
        "quick_lesson",
        level,
        quickLessonActivity.id,
        questionIndex,
        correctAnswers,
      );
    }
  };

  const quickLessonCorrectCount = quickLessonActivity
    ? quickLessonActivity.questions.filter(
      (question, index) => quickLessonAnswers[index] === question.answer,
    ).length
    : 0;
  const quickLessonAllAnswered = Boolean(
    quickLessonActivity
    && quickLessonActivity.questions.length > 0
    && quickLessonActivity.questions.every((_, index) => quickLessonAnswers[index] !== undefined),
  );

  const answerGrammarExercise = (index: number) => {
    if (selectedAnswer !== null || !grammarExercise) return;
    setSelectedAnswer(index);
    void recordProgress(
      grammarExercise.id,
      "grammar",
      index === grammarExercise.answer ? 100 : 0,
    );
    if (index !== grammarExercise.answer) {
      void recordMistake(grammarExercise.id, "grammar", 0, index);
    }
  };

  const moveGrammarExercise = (direction: -1 | 1) => {
    setGrammarExerciseIndex((current) => {
      let next = current + direction;
      while (
        next >= 0
        && next < grammarExercises.length
        && completedActivityIds.has(grammarExercises[next].id)
      ) {
        next += direction;
      }
      const bounded = Math.max(0, Math.min(grammarExercises.length - 1, next));
      if (grammarTopic) {
        void saveSectionCursor("grammar", level, grammarTopic.id, bounded, 0, "exercises");
      }
      return bounded;
    });
    setSelectedAnswer(null);
    setSaved(false);
  };

  const chooseGrammarView = (view: GrammarView) => {
    setGrammarView(view);
    setGrammarExerciseIndex(0);
    setSelectedAnswer(null);
    setSaved(false);
    if (grammarTopic) {
      const firstExercise = grammarExercises.findIndex(
        (exercise) => !completedActivityIds.has(exercise.id),
      );
      const nextExerciseIndex = firstExercise < 0 ? 0 : firstExercise;
      setGrammarExerciseIndex(nextExerciseIndex);
      void saveSectionCursor(
        "grammar",
        level,
        grammarTopic.id,
        nextExerciseIndex,
        0,
        view,
      );
    }
  };

  const chooseGrammarTopic = (index: number) => {
    setActivityIndex(index);
    setGrammarExerciseIndex(0);
    setSelectedAnswer(null);
    setSaved(false);
    const topic = grammarTopics[index];
    if (topic) void saveSectionCursor("grammar", level, topic.id, 0, 0, "explanations");
  };

  const answerReading = (questionIndex: number, optionIndex: number) => {
    if (!readingActivity || readingAnswers[questionIndex] !== undefined) return;
    const question = readingActivity.questions[questionIndex];
    if (!question) return;

    const nextAnswers = { ...readingAnswers, [questionIndex]: optionIndex };
    setReadingAnswers(nextAnswers);

    if (optionIndex !== question.answer) {
      void recordMistake(readingActivity.id, "reading", questionIndex, optionIndex);
    }

    const allAnswered = readingActivity.questions.every(
      (_, index) => nextAnswers[index] !== undefined,
    );
    const correctAnswers = readingActivity.questions.filter(
      (item, index) => nextAnswers[index] === item.answer,
    ).length;

    if (allAnswered) {
      const score = Math.round((correctAnswers / readingActivity.questions.length) * 100);
      void recordProgress(readingActivity.id, "reading", score);
    } else {
      void saveSectionCursor(
        "reading",
        level,
        readingActivity.id,
        questionIndex,
        correctAnswers,
      );
    }
  };

  const readingCorrectCount = readingActivity
    ? readingActivity.questions.filter(
      (question, index) => readingAnswers[index] === question.answer,
    ).length
    : 0;
  const readingAllAnswered = Boolean(
    readingActivity
    && readingActivity.questions.length > 0
    && readingActivity.questions.every((_, index) => readingAnswers[index] !== undefined),
  );

  const rateCard = (remembered: boolean) => {
    const isLast = cardIndex === learning.flashcards.length - 1;
    const flashcard = learning.flashcards[cardIndex];
    if (!flashcard) return;
    if (catalogClient) {
      void catalogClient.rpc("review_learning_mistake", {
        p_item_id: flashcard.id,
        p_remembered: remembered,
      });
    }
    if (remembered) {
      setLearningContent((current) => current
        ? { ...current, flashcards: current.flashcards.filter((item) => item.id !== flashcard.id) }
        : current);
      setCardIndex(Math.max(0, Math.min(cardIndex, learning.flashcards.length - 2)));
    } else {
      setCardIndex(isLast ? 0 : cardIndex + 1);
    }
    setFlipped(false);
  };

  if (!learningContent) {
    return (
      <div className="screen-content">
        <AppHeader title={reviewOnly ? "Revisar" : "Aprender"} subtitle={reviewOnly ? "Fortaleça o vocabulário que você está aprendendo." : "Lições rápidas, leitura e gramática no seu ritmo."} displayName={displayName}/>
        <div className="learning-loading">
          {contentError ? <><BookOpen/><p>{contentError}</p><Button onClick={() => setContentVersion((value) => value + 1)}>Tentar novamente</Button></> : <><Sparkles/><p>Carregando seu catálogo...</p></>}
        </div>
      </div>
    );
  }

  return (
    <div className="screen-content">
      <AppHeader title={reviewOnly ? "Revisar" : "Aprender"} subtitle={reviewOnly ? "Fortaleça o vocabulário que você está aprendendo." : "Lições rápidas, leitura e gramática no seu ritmo."} displayName={displayName}/>
      {!reviewOnly && (
        <div className="learning-tabs" role="tablist">
          <button className={mode === "summary" ? "active" : ""} onClick={() => chooseMode("summary")}><Map/> Sumário</button>
          <button className={mode === "quick_lesson" ? "active" : ""} onClick={() => chooseMode("quick_lesson")}><Zap/> Lição rápida</button>
          <button className={mode === "reading" ? "active" : ""} onClick={() => chooseMode("reading")}><BookOpen/> Leitura</button>
          <button className={mode === "grammar" ? "active" : ""} onClick={() => chooseMode("grammar")}><Languages/> Gramática</button>
        </div>
      )}

      {mode !== "review" && mode !== "summary" && (
        <div className="level-tabs">
          {(["A1", "A2", "B1", "B2"] as LearningLevel[]).map((item) => (
            <button key={item} className={level === item ? "active" : ""} onClick={() => chooseLevel(item)}>{item}</button>
          ))}
        </div>
      )}

      {mode === "summary" && (
        <section className="learning-catalog">
          <header>
            <div><span className="eyebrow">CONTEÚDO DISPONÍVEL</span><h2>Sumário de aprendizagem</h2><p>Explore todas as atividades de {languageDetails[language].name} e continue pelo tema que preferir.</p></div>
            <span>{learning.quickLessons.length + learning.readings.length + learning.grammarTopics.length} conteúdos</span>
          </header>
          <div className="catalog-sections">
            <article>
              <div className="catalog-section-title"><span><Zap/></span><div><h3>Lições rápidas</h3><p>Textos curtos com exercícios de completar alinhados ao conteúdo.</p></div><strong>{completedQuickLessons}/{learning.quickLessons.length}</strong></div>
              {(["A1", "A2", "B1", "B2"] as LearningLevel[]).map((catalogLevel) => {
                const items = learning.quickLessons.filter((item) => item.level === catalogLevel);
                return <details key={catalogLevel} open={catalogLevel === preferredLevel}><summary><span>{catalogLevel}</span><strong>{items.filter((item) => completedActivityIds.has(item.id)).length}/{items.length} concluídas</strong><ChevronRight/></summary><div>{items.map((item, index) => {
                  const completed = completedActivityIds.has(item.id);
                  return <button key={item.id} className={completed ? "completed" : ""} disabled={completed} onClick={() => openCatalogItem("quick_lesson", catalogLevel, index)}><span>{completed ? <Check/> : index + 1}</span><div><strong>{item.title}</strong><small>{completed ? "Concluída" : `${item.questions.length} exercícios`}</small></div>{!completed && <ArrowRight/>}</button>;
                })}</div></details>;
              })}
            </article>

            <article>
              <div className="catalog-section-title"><span><BookOpen/></span><div><h3>Leituras</h3><p>Textos progressivos com questionários de compreensão.</p></div><strong>{completedReadings}/{learning.readings.length}</strong></div>
              {(["A1", "A2", "B1", "B2"] as LearningLevel[]).map((catalogLevel) => {
                const items = learning.readings.filter((item) => item.level === catalogLevel);
                return <details key={catalogLevel} open={catalogLevel === preferredLevel}><summary><span>{catalogLevel}</span><strong>{items.filter((item) => completedActivityIds.has(item.id)).length}/{items.length} concluídos</strong><ChevronRight/></summary><div>{items.map((item, index) => {
                  const completed = completedActivityIds.has(item.id);
                  return <button key={item.id} className={completed ? "completed" : ""} disabled={completed} onClick={() => openCatalogItem("reading", catalogLevel, index)}><span>{completed ? <Check/> : index + 1}</span><div><strong>{item.title}</strong><small>{completed ? "Concluído" : `${item.paragraphs.length} parágrafos · ${item.questions.length} perguntas`}</small></div>{!completed && <ArrowRight/>}</button>;
                })}</div></details>;
              })}
            </article>

            <article>
              <div className="catalog-section-title"><span><Languages/></span><div><h3>Gramática</h3><p>Explicações completas e exercícios organizados por tema.</p></div><strong>{completedGrammarTopics}/{learning.grammarTopics.length}</strong></div>
              {(["A1", "A2", "B1", "B2"] as LearningLevel[]).map((catalogLevel) => {
                const items = learning.grammarTopics.filter((item) => item.level === catalogLevel);
                const completedTopicsInLevel = items.filter((topic) => {
                  const topicExercises = learning.grammarExercises.filter((exercise) => exercise.topicId === topic.id);
                  return topicExercises.length > 0
                    && topicExercises.every((exercise) => completedActivityIds.has(exercise.id));
                }).length;
                return <details key={catalogLevel} open={catalogLevel === preferredLevel}><summary><span>{catalogLevel}</span><strong>{completedTopicsInLevel}/{items.length} concluídos</strong><ChevronRight/></summary><div>{items.map((item, index) => {
                  const topicExercises = learning.grammarExercises.filter((exercise) => exercise.topicId === item.id);
                  const exerciseCount = topicExercises.length;
                  const completedCount = topicExercises.filter((exercise) => completedActivityIds.has(exercise.id)).length;
                  const completed = exerciseCount > 0 && completedCount === exerciseCount;
                  return <button key={item.id} className={completed ? "completed" : ""} disabled={completed} onClick={() => openCatalogItem("grammar", catalogLevel, index)}><span>{completed ? <Check/> : index + 1}</span><div><strong>{item.title}</strong><small>{completed ? "Concluído" : `${item.useCases.length} casos de uso · ${completedCount}/${exerciseCount} exercícios`}</small></div>{!completed && <ArrowRight/>}</button>;
                })}</div></details>;
              })}
            </article>
          </div>
        </section>
      )}

      {mode === "quick_lesson" && quickLessonActivity && (
          <article className="learning-activity">
            <div className="learning-activity-heading"><span className="level-chip">{level} · {languageDetails[language].name}</span><strong>{activityIndex + 1} de {activityCount}</strong></div>
            <h2>{quickLessonActivity.title}</h2>
            <p className="reading-text">{quickLessonActivity.text}</p>
            <div className="quick-lesson-exercises">
              <div className="reading-question-progress">
                <strong>{quickLessonActivity.questions.length} exercícios</strong>
                <span>{quickLessonCorrectCount} acerto{quickLessonCorrectCount === 1 ? "" : "s"}</span>
              </div>
              {quickLessonActivity.questions.map((question, questionIndex) => {
                const selected = quickLessonAnswers[questionIndex];
                const answered = selected !== undefined;
                return (
                  <section key={`${quickLessonActivity.id}-${questionIndex}`} className="learning-question reading-comprehension">
                    <strong>Exercício {questionIndex + 1}</strong>
                    <h3>{question.prompt}</h3>
                    <div>
                      {question.options.map((option, optionIndex) => {
                        const className = answered
                          ? optionIndex === question.answer ? "correct" : optionIndex === selected ? "wrong" : ""
                          : "";
                        return (
                          <button
                            key={`${option}-${optionIndex}`}
                            className={className}
                            onClick={() => answerActivity(questionIndex, optionIndex)}
                            disabled={answered}
                          >
                            {option}
                            {answered && optionIndex === question.answer && <Check/>}
                          </button>
                        );
                      })}
                    </div>
                    {answered && (
                      <div className="reading-feedback">
                        <p className={selected === question.answer ? "answer-success" : "answer-error"}>
                          {selected === question.answer ? "Muito bem! Resposta correta." : "Quase! Observe a resposta destacada e tente novamente depois."}
                        </p>
                        {question.explanation && <p>{question.explanation}</p>}
                      </div>
                    )}
                  </section>
                );
              })}
              {quickLessonAllAnswered && (
                <p className="answer-success">
                  Lição concluída: {Math.round((quickLessonCorrectCount / quickLessonActivity.questions.length) * 100)}%
                  {saved && " · progresso salvo"}
                </p>
              )}
            </div>
            <div className="learning-navigation">
              <Button variant="secondary" disabled={activityIndex === 0} onClick={() => moveActivity(-1)} icon={<ArrowLeft/>}>Anterior</Button>
              <Button disabled={activityIndex === activityCount - 1} onClick={() => moveActivity(1)} icon={<ArrowRight/>}>Próxima</Button>
            </div>
          </article>
      )}

      {mode === "grammar" && grammarTopic && (
        <section className="grammar-module">
          <div className="grammar-subtabs" role="tablist">
            <button className={grammarView === "explanations" ? "active" : ""} onClick={() => chooseGrammarView("explanations")}><BookOpen/> Explicações</button>
            <button className={grammarView === "exercises" ? "active" : ""} onClick={() => chooseGrammarView("exercises")}><CheckCircle2/> Exercícios</button>
          </div>
          <label className="grammar-topic-picker">
            <span>Tema gramatical</span>
            <select value={activityIndex} onChange={(event) => chooseGrammarTopic(Number(event.target.value))}>
              {grammarTopics.map((topic, index) => <option key={topic.id} value={index}>{topic.title}</option>)}
            </select>
          </label>

          {grammarView === "explanations" && (
            <article className="grammar-guide">
              <header>
                <div><span className="level-chip">{level} · {languageDetails[language].name}</span><h2>{grammarTopic.title}</h2></div>
                <strong>Tema {activityIndex + 1} de {activityCount}</strong>
              </header>
              <section className="grammar-overview"><h3>Entenda o tema</h3>{grammarTopic.overview.split(/\n+/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</section>
              <section className="grammar-formation"><h3>Como formar</h3><GrammarFormation value={grammarTopic.formation}/></section>
              <section className="grammar-use-cases"><h3>Casos de uso</h3>
                <div>{grammarTopic.useCases.map((useCase, index) => (
                  <article key={`${useCase.title}-${index}`}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div><h4>{useCase.title}</h4><p>{useCase.explanation}</p>
                      <ul>{useCase.examples.map((example, exampleIndex) => <li key={`${example.target}-${exampleIndex}`}><strong>{example.target}</strong><small>{example.translation}</small></li>)}</ul>
                    </div>
                  </article>
                ))}</div>
              </section>
              <section className="grammar-mistakes"><h3>Erros comuns</h3>
                <div>{grammarTopic.commonMistakes.map((mistake, index) => {
                  const hasComparison = Boolean(mistake.incorrect && mistake.correct);
                  return (
                    <article key={index} className={hasComparison ? "" : "text-only"}>
                      {hasComparison && <><del>{mistake.incorrect}</del><ArrowRight/><ins>{mistake.correct}</ins></>}
                      <p>{mistake.explanation}</p>
                    </article>
                  );
                })}</div>
              </section>
              <section className="grammar-notes"><h3>Para lembrar</h3><ul>{grammarTopic.notes.map((note) => <li key={note}>{note}</li>)}</ul></section>
              <div className="learning-navigation">
                <Button variant="secondary" disabled={activityIndex === 0} onClick={() => moveActivity(-1)} icon={<ArrowLeft/>}>Tema anterior</Button>
                <Button disabled={grammarTopicComplete} onClick={() => chooseGrammarView("exercises")} icon={<CheckCircle2/>}>{grammarTopicComplete ? "Exercícios concluídos" : "Praticar este tema"}</Button>
                <Button disabled={activityIndex === activityCount - 1} onClick={() => moveActivity(1)} icon={<ArrowRight/>}>Próximo tema</Button>
              </div>
            </article>
          )}

          {grammarView === "exercises" && grammarExercise && (
            <article className="learning-activity grammar-exercise">
              <div className="learning-activity-heading"><span className="level-chip">{grammarTopic.title}</span><strong>Exercício {grammarExerciseIndex + 1} de {grammarExercises.length}</strong></div>
              <h2>Pratique: {grammarTopic.title}</h2>
              <section className="learning-question">
                <strong>{grammarExercise.question}</strong>
                <div>{grammarExercise.options.map((option, index) => {
                  const answered = selectedAnswer !== null;
                  const className = answered
                    ? index === grammarExercise.answer ? "correct" : index === selectedAnswer ? "wrong" : ""
                    : "";
                  return <button key={option} className={className} onClick={() => answerGrammarExercise(index)} disabled={answered}>{option}{answered && index === grammarExercise.answer && <Check/>}</button>;
                })}</div>
                {selectedAnswer !== null && <p className={selectedAnswer === grammarExercise.answer ? "answer-success" : "answer-error"}>{selectedAnswer === grammarExercise.answer ? "Muito bem! Resposta correta." : "Revise a regra e observe a resposta destacada."}{saved && " Progresso salvo."}</p>}
              </section>
              <div className="learning-navigation">
                <Button variant="secondary" onClick={() => chooseGrammarView("explanations")} icon={<BookOpen/>}>Ver explicação</Button>
                <Button variant="secondary" disabled={grammarExerciseIndex === 0} onClick={() => moveGrammarExercise(-1)} icon={<ArrowLeft/>}>Anterior</Button>
                <Button disabled={grammarExerciseIndex === grammarExercises.length - 1} onClick={() => moveGrammarExercise(1)} icon={<ArrowRight/>}>Próximo exercício</Button>
              </div>
            </article>
          )}
        </section>
      )}

      {mode === "reading" && readingActivity && (
        <article className="learning-activity reading-activity">
          <div className="learning-activity-heading">
            <span className="level-chip">{level} · {languageDetails[language].name}</span>
            <strong>Texto {activityIndex + 1} de {activityCount}</strong>
          </div>
          <h2>{readingActivity.title}</h2>
          <div className="reading-passage">
            {readingActivity.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
          </div>
          <div className="quick-lesson-exercises">
            <div className="reading-question-progress">
              <strong>{readingActivity.questions.length} perguntas</strong>
              <span>{readingCorrectCount} acerto{readingCorrectCount === 1 ? "" : "s"}</span>
            </div>
            {readingActivity.questions.map((question, questionIndex) => {
              const selected = readingAnswers[questionIndex];
              const answered = selected !== undefined;
              return (
                <section key={`${readingActivity.id}-${questionIndex}`} className="learning-question reading-comprehension">
                  <strong>Pergunta {questionIndex + 1}</strong>
                  <h3>{question.prompt}</h3>
                  <div>
                    {question.options.map((option, optionIndex) => {
                      const className = answered
                        ? optionIndex === question.answer ? "correct" : optionIndex === selected ? "wrong" : ""
                        : "";
                      return (
                        <button
                          key={`${option}-${optionIndex}`}
                          className={className}
                          onClick={() => answerReading(questionIndex, optionIndex)}
                          disabled={answered}
                        >
                          {option}
                          {answered && optionIndex === question.answer && <Check/>}
                        </button>
                      );
                    })}
                  </div>
                  {answered && (
                    <div className="reading-feedback">
                      <p className={selected === question.answer ? "answer-success" : "answer-error"}>
                        {selected === question.answer ? "Muito bem! Resposta correta." : "A resposta correta está destacada."}
                      </p>
                      {question.explanation && <p>{question.explanation}</p>}
                    </div>
                  )}
                </section>
              );
            })}
            {readingAllAnswered && (
              <p className="answer-success">
                Leitura concluída: {Math.round((readingCorrectCount / readingActivity.questions.length) * 100)}%
                {saved && " · progresso salvo"}
              </p>
            )}
          </div>
          <div className="learning-navigation">
            <Button variant="secondary" disabled={activityIndex === 0} onClick={() => moveActivity(-1)} icon={<ArrowLeft/>}>Texto anterior</Button>
            <Button disabled={activityIndex === activityCount - 1} onClick={() => moveActivity(1)} icon={<ArrowRight/>}>Próximo texto</Button>
          </div>
        </article>
      )}

      {mode === "review" && (
        <div className="quick-lesson">
          {learning.flashcards.length === 0 ? (
            <div className="review-empty">
              <CheckCircle2/>
              <h2>Nada para revisar agora</h2>
              <p>Os erros cometidos em lições, leituras, exercícios de gramática e conversas aparecerão aqui.</p>
              <div className="review-empty-actions">
                <Button onClick={() => { setLearningContent(null); chooseMode("quick_lesson"); }} icon={<Zap/>}>Fazer uma lição rápida</Button>
                <Button variant="secondary" onClick={goToScenarios} icon={<MessageCircle/>}>Praticar conversação</Button>
              </div>
            </div>
          ) : (() => {
            const item = learning.flashcards[Math.min(cardIndex, learning.flashcards.length - 1)];
            const sourceLabels = { quick_lesson: "Lição rápida", reading: "Leitura", grammar: "Gramática", conversation: "Conversação" };
            return <>
              <div className="quick-lesson-progress"><span>{sourceLabels[item.sourceType]} · {item.level}</span><strong>{Math.min(cardIndex + 1, learning.flashcards.length)}/{learning.flashcards.length}</strong></div>
              <button className={`learning-flashcard${flipped ? " flipped" : ""}`} onClick={() => setFlipped(!flipped)}>
                <small>{flipped ? "RESPOSTA CORRETA" : "SEU ERRO"}</small>
                <strong>{flipped ? item.correctAnswer : item.learnerAnswer}</strong>
                <p>{flipped ? item.explanation || item.prompt : item.prompt}</p>
                <span>{flipped ? "Você consegue lembrar agora?" : "Toque para ver a correção"}</span>
              </button>
              {flipped && planId === "premium" && session?.access_token && (
                <div className="review-speech">
                  <SpeechPlayback
                    text={item.correctAnswer}
                    language={language}
                    accessToken={session.access_token}
                    enabled
                    label="Ouvir correção"
                    onUpgrade={goToPricing}
                  />
                </div>
              )}
              {flipped && <div className="quick-lesson-actions"><Button variant="secondary" onClick={() => rateCard(false)}>Ainda preciso revisar</Button><Button onClick={() => rateCard(true)}>Agora aprendi</Button></div>}
            </>;
          })()}
        </div>
      )}
    </div>
  );
}

function PrototypeNavigator({
  current,
  go,
}: {
  current: ScreenId;
  go: (id: ScreenId) => void;
}) {
  const [open, setOpen] = useState(false);
  const currentIndex = screens.findIndex((screen) => screen.id === current);
  return (
    <>
      <button className="prototype-trigger" onClick={() => setOpen(!open)}>
        <Map size={17}/><span>Mapa de telas</span><strong>{currentIndex + 1}/{screens.length}</strong>
      </button>
      {open && (
        <div className="prototype-panel">
          <div className="prototype-head"><div><strong>Protótipo navegável</strong><span>{screens.length} telas do produto</span></div><button onClick={() => setOpen(false)}><X/></button></div>
          {["Entrada","Produto","Progresso","Conta"].map((group)=><div className="prototype-group" key={group}><span>{group}</span>{screens.filter((screen)=>screen.group===group).map(({id,label,icon:Icon})=><button key={id} className={current===id?"active":""} onClick={()=>{go(id);setOpen(false)}}><Icon size={17}/>{label}{current===id&&<Check size={15}/>}</button>)}</div>)}
          <div className="prototype-arrows"><button disabled={currentIndex===0} onClick={()=>go(screens[Math.max(0,currentIndex-1)].id)}><ArrowLeft/> Anterior</button><button disabled={currentIndex===screens.length-1} onClick={()=>go(screens[Math.min(screens.length-1,currentIndex+1)].id)}>Próxima <ArrowRight/></button></div>
        </div>
      )}
    </>
  );
}

export default function ProductPrototype() {
  const [screen, setScreen] = useState<ScreenId>("landing");
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [displayName, setDisplayName] = useState("Aluno");
  const [preferences, setPreferences] = useState<LearnerPreferences | null>(null);
  const [studiedLanguages, setStudiedLanguages] = useState<LearnerLanguage[]>([]);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);
  const [scenarios, setScenarios] = useState<ScenarioCatalogItem[]>([]);
  const [catalogError, setCatalogError] = useState("");
  const [catalogVersion, setCatalogVersion] = useState(0);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [completedConversation, setCompletedConversation] =
    useState<CompletedConversationView | null>(null);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [pendingEmail, setPendingEmail] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [planId, setPlanId] = useState("free");
  const [planResolvedUserId, setPlanResolvedUserId] = useState<string | null>(null);

  const refreshPlan = useCallback(async (accessToken: string, userId: string) => {
    try {
      const summary = await loadEntitlements(accessToken);
      setPlanId(summary.plan_id);
    } catch {
      setPlanId("free");
    } finally {
      setPlanResolvedUserId(userId);
    }
  }, []);

  const refreshAdminAccess = async (userId: string | undefined) => {
    if (!userId) {
      setIsAdmin(false);
      return;
    }
    setIsAdmin(await loadIsAdmin(userId));
  };

  const loadStudiedLanguages = async (userId: string, nextPreferences: LearnerPreferences | null) => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setStudiedLanguages(fallbackStudiedLanguages(nextPreferences));
      return;
    }

    const { data, error } = await supabase
      .from("learner_languages")
      .select("target_language,current_level")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (error || !data?.length) {
      setStudiedLanguages(fallbackStudiedLanguages(nextPreferences));
      return;
    }

    setStudiedLanguages(mapLearnerLanguages(data as LearnerLanguageRow[]));
  };

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      const frame = window.requestAnimationFrame(() => setAuthLoading(false));
      return () => window.cancelAnimationFrame(frame);
    }

    let active = true;
    const initialize = async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;

      let currentSession = data.session;
      if (currentSession && !isEmailConfirmed(currentSession.user)) {
        const unconfirmedEmail = currentSession.user.email?.trim().toLowerCase() || "";
        if (unconfirmedEmail) window.sessionStorage.setItem("lume:pending-email", unconfirmedEmail);
        currentSession = null;
      }
      setSession(currentSession);
      const storedPendingEmail = window.sessionStorage.getItem("lume:pending-email") || "";
      const isEmailConfirmation = window.location.hash.includes("type=signup") || window.location.search.includes("type=signup");
      const isPasswordReset = isPasswordRecoveryCallback(window.location.hash, window.location.search);
      let currentOnboardingCompleted = false;
      if (currentSession) {
        setSelectedScenarioId(
          window.sessionStorage.getItem(scenarioStorageKey(currentSession.user.id)),
        );
      }
      setPendingEmail(storedPendingEmail);
      if (currentSession) {
        setDisplayName(currentSession.user.user_metadata.display_name || currentSession.user.email?.split("@")[0] || "Aluno");
        const [{ data: profile }, { data: preferencesRow }] = await Promise.all([
          supabase
            .from("profiles")
            .select("display_name,onboarding_completed")
            .eq("id", currentSession.user.id)
            .maybeSingle(),
          supabase
            .from("learner_preferences")
            .select("target_language,current_level,learning_goal,study_minutes_per_day,study_days_per_week,correction_preference,interests,desired_scenarios")
            .eq("user_id", currentSession.user.id)
            .maybeSingle(),
        ]);
        if (profile?.display_name) setDisplayName(profile.display_name);
        currentOnboardingCompleted = Boolean(profile?.onboarding_completed && preferencesRow);
        setOnboardingCompleted(currentOnboardingCompleted);
        const mappedPreferences = preferencesRow
          ? mapLearnerPreferences(preferencesRow as LearnerPreferencesRow)
          : null;
        setPreferences(mappedPreferences);
        await Promise.all([
          loadStudiedLanguages(currentSession.user.id, mappedPreferences),
          refreshAdminAccess(currentSession.user.id),
          refreshPlan(currentSession.access_token, currentSession.user.id),
        ]);
      } else {
        setPlanId("free");
        setPlanResolvedUserId(null);
      }

      const fromHash = window.location.hash.replace("#/", "") as ScreenId;
      if (currentSession && isPasswordReset) {
        setPasswordRecovery(true);
        setScreen("recover");
        window.history.replaceState(null, "", "#/recover");
      } else if (currentSession && (storedPendingEmail || isEmailConfirmation)) {
        window.sessionStorage.removeItem("lume:pending-email");
        setPendingEmail("");
        setScreen("onboarding");
        window.history.replaceState(null, "", "#/onboarding");
      } else if (screens.some((item) => item.id === fromHash)) {
        const destination = resolveDestination(fromHash, Boolean(currentSession), currentOnboardingCompleted) as ScreenId;
        setScreen(destination);
        if (destination !== fromHash) window.history.replaceState(null, "", `#/${destination}`);
      }
      setAuthLoading(false);
    };

    void initialize();
    const { data: authListener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "SIGNED_OUT") {
        setSession(null);
        setPlanId("free");
        setPlanResolvedUserId(null);
        setPreferences(null);
        setStudiedLanguages([]);
        setIsAdmin(false);
        setOnboardingCompleted(false);
        setDisplayName("Aluno");
        setScreen("login");
        window.history.replaceState(null, "", "#/login");
        return;
      }
      if (nextSession && !isEmailConfirmed(nextSession.user)) {
        const unconfirmedEmail = nextSession.user.email?.trim().toLowerCase() || "";
        if (unconfirmedEmail) {
          window.sessionStorage.setItem("lume:pending-email", unconfirmedEmail);
          setPendingEmail(unconfirmedEmail);
        }
        setSession(null);
        setPlanId("free");
        setPlanResolvedUserId(null);
        setScreen("confirm-email");
        window.history.replaceState(null, "", "#/confirm-email");
        return;
      }
      setSession(nextSession);
      if (nextSession) {
        setDisplayName(nextSession.user.user_metadata.display_name || nextSession.user.email?.split("@")[0] || "Aluno");
        if (event === "SIGNED_IN") {
          setPlanResolvedUserId(null);
          void refreshPlan(nextSession.access_token, nextSession.user.id);
        }
      }
      if (event === "PASSWORD_RECOVERY") {
        setPasswordRecovery(true);
        setScreen("recover");
        window.history.replaceState(null, "", "#/recover");
      }
      const isEmailConfirmation = window.location.hash.includes("type=signup") || window.location.search.includes("type=signup");
      if (event === "SIGNED_IN" && nextSession && (window.sessionStorage.getItem("lume:pending-email") || isEmailConfirmation)) {
        window.sessionStorage.removeItem("lume:pending-email");
        setPendingEmail("");
        setScreen("onboarding");
        window.history.replaceState(null, "", "#/onboarding");
      }
    });

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [refreshPlan]);

  // O catálogo de cenários vem do banco, então adicionar ou despublicar um
  // cenário não exige republicar o frontend.
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) return;
    let active = true;
    const load = async () => {
      setCatalogError("");
      try {
        const catalog = await loadScenarioCatalog(supabase);
        if (!active) return;
        if (!catalog.length) {
          setCatalogError("Nenhum cenário publicado no momento.");
          return;
        }
        setScenarios(catalog);
      } catch {
        if (active) setCatalogError("Não foi possível carregar os cenários de conversa.");
      }
    };
    void load();
    return () => { active = false; };
  }, [catalogVersion, session]);

  useEffect(() => {
    if (authLoading) return;
    const restoreNavigation = () => {
      const requested = window.location.hash.replace("#/", "") as ScreenId;
      if (!screens.some(({ id }) => id === requested)) return;
      const destination = resolveDestination(requested, Boolean(session), onboardingCompleted) as ScreenId;
      setScreen(destination);
      if (destination !== requested) window.history.replaceState(null, "", `#/${destination}`);
    };
    window.addEventListener("popstate", restoreNavigation);
    return () => window.removeEventListener("popstate", restoreNavigation);
  }, [authLoading, onboardingCompleted, session]);

  useEffect(() => {
    if (!session?.access_token) return;
    const refreshVisiblePlan = () => {
      if (document.visibilityState === "visible") {
        void refreshPlan(session.access_token, session.user.id);
      }
    };
    window.addEventListener("focus", refreshVisiblePlan);
    document.addEventListener("visibilitychange", refreshVisiblePlan);
    return () => {
      window.removeEventListener("focus", refreshVisiblePlan);
      document.removeEventListener("visibilitychange", refreshVisiblePlan);
    };
  }, [refreshPlan, session]);

  const navigate = (id: ScreenId, replace = false) => {
    setScreen(id);
    window.history[replace ? "replaceState" : "pushState"](null, "", `#/${id}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const go = (id: ScreenId) => {
    const destination = resolveDestination(id, Boolean(session), onboardingCompleted) as ScreenId;
    if (screen === "confirm-email" && (destination === "login" || destination === "signup")) {
      window.sessionStorage.removeItem("lume:pending-email");
      setPendingEmail("");
    }
    navigate(destination);
  };

  const selectScenario = (scenario: ScenarioCatalogItem) => {
    setSelectedScenarioId(scenario.id);
    if (session) window.sessionStorage.setItem(scenarioStorageKey(session.user.id), scenario.id);
    navigate("conversation");
  };

  const conversationCompleted = (completed: CompletedConversationView) => {
    setCompletedConversation(completed);
    navigate("summary", true);
  };

  const submitAuth = async (mode: AuthMode, form: AuthFormData): Promise<AuthFeedback> => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      return { error: "Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY para ativar a autenticação." };
    }

    if (mode === "update" || mode === "signup") {
      const passwordError = validateNewPassword(form.password);
      if (passwordError) return { error: passwordError };
    }

    if (mode === "update") {
      const { error } = await supabase.auth.updateUser({ password: form.password });
      if (error) return { error: error.message };
      setPasswordRecovery(false);
      window.history.replaceState(null, "", window.location.pathname);
      navigate(onboardingCompleted ? "dashboard" : "onboarding");
      return { success: "Senha atualizada com sucesso." };
    }

    if (mode === "recover") {
      const { error } = await supabase.auth.resetPasswordForEmail(form.email, {
        redirectTo: passwordRecoveryRedirectUrl(window.location.origin),
      });
      return error
        ? { error: error.message }
        : { success: "Se existir uma conta com esse email, enviaremos um link de recuperação." };
    }

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          data: {
            display_name: form.name.trim(),
            terms_accepted: true,
            privacy_policy_version: "2026-07-28",
          },
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) return { error: error.message };
      if (!data.session || !isEmailConfirmed(data.user)) {
        const normalizedEmail = form.email.trim().toLowerCase();
        window.sessionStorage.setItem("lume:pending-email", normalizedEmail);
        setPendingEmail(normalizedEmail);
        navigate("confirm-email");
        return {};
      }
      setSession(data.session);
      setDisplayName(form.name.trim() || "Aluno");
      await refreshPlan(data.session.access_token, data.session.user.id);
      navigate("onboarding");
      return {};
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: form.email,
      password: form.password,
    });
    if (error) return { error: error.message };
    if (!isEmailConfirmed(data.user)) {
      const normalizedEmail = form.email.trim().toLowerCase();
      window.sessionStorage.setItem("lume:pending-email", normalizedEmail);
      setPendingEmail(normalizedEmail);
      navigate("confirm-email");
      return {};
    }

    setSession(data.session);
    setDisplayName(data.user.user_metadata.display_name || data.user.email?.split("@")[0] || "Aluno");
    const [{ data: profile, error: profileError }, { data: preferencesRow, error: preferencesError }] = await Promise.all([
      supabase
        .from("profiles")
        .select("display_name,onboarding_completed")
        .eq("id", data.user.id)
        .maybeSingle(),
      supabase
        .from("learner_preferences")
        .select("target_language,current_level,learning_goal,study_minutes_per_day,study_days_per_week,correction_preference,interests,desired_scenarios")
        .eq("user_id", data.user.id)
        .maybeSingle(),
    ]);

    if (profileError || preferencesError) return { error: "Login realizado, mas não foi possível carregar seu perfil." };
    if (profile?.display_name) setDisplayName(profile.display_name);
    const hasCompletedOnboarding = Boolean(profile?.onboarding_completed && preferencesRow);
    setOnboardingCompleted(hasCompletedOnboarding);
    const mappedPreferences = preferencesRow
      ? mapLearnerPreferences(preferencesRow as LearnerPreferencesRow)
      : null;
    setPreferences(mappedPreferences);
    await Promise.all([
      loadStudiedLanguages(data.user.id, mappedPreferences),
      refreshAdminAccess(data.user.id),
      refreshPlan(data.session.access_token, data.user.id),
    ]);
    navigate(hasCompletedOnboarding ? "dashboard" : "onboarding");
    return {};
  };

  const resendConfirmation = async (email: string): Promise<AuthFeedback> => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return { error: "A autenticação ainda não está configurada." };

    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: window.location.origin },
    });

    return error
      ? { error: error.message }
      : { success: "Um novo link foi enviado. Verifique sua caixa de entrada." };
  };

  const checkConfirmation = async (): Promise<AuthFeedback> => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return { error: "A autenticação ainda não está configurada." };
    const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (refreshError || userError || !refreshData.session || !isEmailConfirmed(userData.user)) {
      return { error: "Ainda não identificamos a confirmação. Abra o link no mesmo navegador e tente novamente." };
    }

    window.sessionStorage.removeItem("lume:pending-email");
    setPendingEmail("");
    setSession(refreshData.session);
    await refreshPlan(refreshData.session.access_token, refreshData.session.user.id);
    navigate("onboarding");
    return {};
  };

  const completeOnboarding = async (data: OnboardingData): Promise<AuthFeedback> => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) {
      go("login");
      return { error: "Sua sessão expirou. Entre novamente para continuar." };
    }

    const { error } = await supabase.rpc("save_learner_settings", {
      p_display_name: displayName,
      p_target_language: data.targetLanguage,
      p_current_level: data.currentLevel,
      p_learning_goal: data.learningGoal,
      p_study_minutes_per_day: data.studyMinutesPerDay,
      p_study_days_per_week: 5,
      p_complete_onboarding: true,
      p_correction_preference: data.correctionPreference,
      p_interests: data.interests,
      p_desired_scenarios: data.desiredScenarios,
    });
    if (error) return { error: "Não foi possível concluir o onboarding. Tente novamente." };

    setPreferences({ ...data, studyDaysPerWeek: 5 });
    await loadStudiedLanguages(session.user.id, { ...data, studyDaysPerWeek: 5 });
    setOnboardingCompleted(true);
    navigate("dashboard");
    return {};
  };

  const saveSettings = async (name: string, nextPreferences: LearnerPreferences): Promise<AuthFeedback> => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) return { error: "Sua sessão expirou. Entre novamente." };
    const normalizedName = name.trim();
    if (!normalizedName) return { error: "Informe um nome para o perfil." };

    const { error } = await supabase.rpc("save_learner_settings", {
      p_display_name: normalizedName,
      p_target_language: nextPreferences.targetLanguage,
      p_current_level: nextPreferences.currentLevel,
      p_learning_goal: nextPreferences.learningGoal,
      p_study_minutes_per_day: nextPreferences.studyMinutesPerDay,
      p_study_days_per_week: nextPreferences.studyDaysPerWeek,
      p_complete_onboarding: false,
      p_correction_preference: nextPreferences.correctionPreference,
      p_interests: nextPreferences.interests,
      p_desired_scenarios: nextPreferences.desiredScenarios,
    });
    if (error) return { error: "Não foi possível salvar as alterações. Tente novamente." };

    // Metadata is only a fallback display source. The transactional profile is authoritative.
    await supabase.auth.updateUser({ data: { display_name: normalizedName } });
    setDisplayName(normalizedName);
    setPreferences(nextPreferences);
    if (session) await loadStudiedLanguages(session.user.id, nextPreferences);
    return { success: "Alterações salvas." };
  };

  const switchLanguage = async (language: TargetLanguage): Promise<{ error?: string }> => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) return { error: "Sua sessão expirou. Entre novamente." };

    const selected = studiedLanguages.find((entry) => entry.targetLanguage === language);
    if (!selected) return { error: "Esse idioma ainda não está na sua lista." };

    const { error } = await supabase.rpc("switch_active_language", {
      p_target_language: language,
    });
    if (error) return { error: "Não foi possível trocar o idioma. Tente novamente." };

    setPreferences((current) =>
      current
        ? {
            ...current,
            targetLanguage: language,
            currentLevel: selected.currentLevel,
          }
        : null,
    );
    setCatalogVersion((value) => value + 1);
    return {};
  };

  const addLanguage = async (
    language: TargetLanguage,
    level: LearnerLanguage["currentLevel"] = "unknown",
  ): Promise<{ error?: string }> => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !session) return { error: "Sua sessão expirou. Entre novamente." };

    const { error } = await supabase.rpc("add_learner_language", {
      p_target_language: language,
      p_current_level: level,
    });
    if (error) return { error: "Não foi possível adicionar esse idioma." };

    await loadStudiedLanguages(session.user.id, preferences);
    return {};
  };

  const signOut = async () => {
    const supabase = getSupabaseBrowserClient();
    if (supabase) await supabase.auth.signOut();
    setSession(null);
    setPreferences(null);
    setOnboardingCompleted(false);
    setPlanId("free");
    go("landing");
  };

  const accountDeleted = async () => {
    if (session?.user.id) {
      // O onboarding e o cenário selecionado são gravados em sessionStorage;
      // limpar localStorage não removia nada.
      const onboardingKeys = onboardingStorageKeys(session.user.id);
      window.sessionStorage.removeItem(onboardingKeys.draft);
      window.sessionStorage.removeItem(onboardingKeys.step);
      window.sessionStorage.removeItem(scenarioStorageKey(session.user.id));
      window.sessionStorage.removeItem("lume:pending-email");
    }
    setCompletedConversation(null);
    await signOut();
  };

  const selectedScenario =
    scenarios.find(({ id }) => id === selectedScenarioId)
    || recommendScenario(scenarios, preferences?.currentLevel || "unknown", preferences || undefined);

  const content = (() => {
    if (authLoading || Boolean(session && planResolvedUserId !== session.user.id)) {
      return <div className="app-loading"><Sparkles/><span>Preparando seu espaço...</span></div>;
    }
    switch (screen) {
      case "landing": return <Landing go={go}/>;
      case "demo": return <Demo go={go}/>;
      case "signup": return <AuthScreen mode="signup" go={go} submit={submitAuth}/>;
      case "login": return <AuthScreen mode="login" go={go} submit={submitAuth}/>;
      case "recover": return <AuthScreen mode={passwordRecovery ? "update" : "recover"} go={go} submit={submitAuth}/>;
      case "confirm-email": return <ConfirmEmail email={pendingEmail} go={go} resend={resendConfirmation} checkConfirmation={checkConfirmation}/>;
      case "onboarding": return <Onboarding complete={completeOnboarding} go={go} initialPreferences={preferences} userId={session?.user.id || "anonymous"}/>;
      case "dashboard": return <Dashboard go={go} displayName={displayName} preferences={preferences} session={session} scenarios={scenarios} startScenario={selectScenario}/>;
      case "learn": return <LearningCenter key={`learn-${preferences?.targetLanguage || "en"}`} displayName={displayName} preferences={preferences} session={session} goToScenarios={() => go("scenarios")}/>;
      case "plan": return <Plan go={go} displayName={displayName} preferences={preferences} session={session} scenarios={scenarios} startScenario={selectScenario}/>;
      case "scenarios": return <Scenarios go={go} displayName={displayName} preferences={preferences} scenarios={scenarios} catalogError={catalogError} reloadCatalog={() => setCatalogVersion((value) => value + 1)} selectScenario={selectScenario}/>;
      case "conversation":
        return selectedScenario
          ? <Conversation key={selectedScenario.id} scenario={selectedScenario} preferences={preferences} session={session} planId={planId} goBack={() => go("scenarios")} onUpgrade={() => go("pricing")} onCompleted={conversationCompleted}/>
          : <Scenarios go={go} displayName={displayName} preferences={preferences} scenarios={scenarios} catalogError={catalogError} reloadCatalog={() => setCatalogVersion((value) => value + 1)} selectScenario={selectScenario}/>;
      case "summary": return <ConversationSummary completed={completedConversation} planId={planId} accessToken={session?.access_token || ""} onUpgrade={() => go("pricing")} goToScenarios={() => go("scenarios")} goToDashboard={() => go("dashboard")} goToSessions={() => go("sessions")}/>;
      case "sessions": return <SessionHistory displayName={displayName} preferences={preferences} session={session} scenarios={scenarios} go={go} resumeScenario={selectScenario}/>;
      case "vocabulary": return <LearningCenter key={`review-${preferences?.targetLanguage || "en"}`} displayName={displayName} preferences={preferences} session={session} initialMode="review" goToScenarios={() => go("scenarios")}/>;
      case "assessment": return <Assessment displayName={displayName} preferences={preferences}/>;
      case "progress": return <Progress displayName={displayName} preferences={preferences} session={session}/>;
      case "profile": return <Profile key={`${preferences?.targetLanguage}-${preferences?.currentLevel}`} go={go} displayName={displayName} email={session?.user.email || ""} saveSettings={saveSettings} session={session}/>;
      case "privacy": return <Privacy session={session} accountDeleted={accountDeleted}/>;
      case "pricing": return (
        <PricingScreen
          session={session}
          displayName={displayName}
          go={go}
          onSubscribed={
            session?.access_token
              ? () => refreshPlan(session.access_token, session.user.id)
              : undefined
          }
        />
      );
      case "billing-success": return <BillingResultScreen session={session} variant="success" go={(id) => { if (session?.access_token) void refreshPlan(session.access_token, session.user.id); go(id); }}/>;
      case "billing-cancel": return <BillingResultScreen session={session} variant="cancel" go={go}/>;
      case "admin": return session ? <AdminPanel session={session} go={go}/> : null;
    }
  })();

  return (
    <LearnerProvider
      preferences={preferences}
      studiedLanguages={studiedLanguages}
      isAdmin={isAdmin}
      planId={planId}
      goToPricing={() => go("pricing")}
      switchLanguage={switchLanguage}
      addLanguage={addLanguage}
    >
    <div className={appScreens.has(screen) ? "app-shell" : screen === "admin" ? "public-page admin-page" : "public-page"}>
      {appScreens.has(screen) && (
        <a className="skip-link" href="#app-main">
          Ir para o conteúdo
        </a>
      )}
      {appScreens.has(screen) && screen !== "conversation" && screen !== "pricing" && screen !== "billing-success" && screen !== "billing-cancel" && <AppNav current={screen} go={go} displayName={displayName} signOut={signOut}/>}
      <div
        id="app-main"
        tabIndex={-1}
        className={appScreens.has(screen) && screen !== "conversation" ? "app-main" : "full-main"}
      >
        {content}
      </div>
      {process.env.NODE_ENV === "development" && <PrototypeNavigator current={screen} go={go}/>}
    </div>
    </LearnerProvider>
  );
}
