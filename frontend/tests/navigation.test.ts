import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { calculateDashboardMetrics } from "../src/lib/progress.ts";
import { parseGrammarFormation } from "../src/lib/grammar-format.ts";
import {
  normalizeGrammarMistakes,
  normalizeGrammarNotes,
  normalizeGrammarUseCases,
} from "../src/lib/learning-content.ts";
import {
  formatElapsed,
  recommendScenario,
  sessionProgressPercent,
  type ScenarioCatalogItem,
} from "../src/lib/conversation.ts";
import {
  isEmailConfirmed,
  isPasswordRecoveryCallback,
  onboardingStorageKeys,
  passwordRecoveryRedirectUrl,
  resolveDestination,
  scenarioStorageKey,
  validateNewPassword,
} from "../src/lib/navigation.ts";

test("visitante é enviado ao login ao abrir tela privada", () => {
  assert.equal(resolveDestination("dashboard", false, false), "login");
  assert.equal(resolveDestination("sessions", false, false), "login");
});

test("usuário autenticado sem onboarding é enviado ao onboarding", () => {
  assert.equal(resolveDestination("plan", true, false), "onboarding");
});

test("usuário com onboarding concluído acessa tela privada", () => {
  assert.equal(resolveDestination("scenarios", true, true), "scenarios");
});

test("usuário com onboarding concluído não refaz o onboarding", () => {
  assert.equal(resolveDestination("onboarding", true, true), "dashboard");
});

test("telas públicas continuam acessíveis", () => {
  assert.equal(resolveDestination("landing", false, false), "landing");
  assert.equal(resolveDestination("demo", false, false), "demo");
});

test("catálogo gramatical aceita conteúdo gerado em formato textual", () => {
  assert.deepEqual(normalizeGrammarUseCases(["Usado para apresentar uma pessoa."]), [{
    title: "Caso 1",
    explanation: "Usado para apresentar uma pessoa.",
    examples: [],
  }]);
  assert.deepEqual(normalizeGrammarMistakes(["Não traduza literalmente do português."]), [{
    incorrect: "",
    correct: "",
    explanation: "Não traduza literalmente do português.",
  }]);
  assert.deepEqual(normalizeGrammarNotes("Leia os exemplos em voz alta."), [
    "Leia os exemplos em voz alta.",
  ]);
});

test("formação gramatical transforma conjugações em tabelas", () => {
  const blocks = parseGrammarFormation(
    "Apresento as formas no presente:\n\n**ESSERE** (ser/estar)\n\n- io sono\n\n- tu sei\n\n**AVERE** (ter)\n\n- io ho\n\n- tu hai",
  );
  assert.deepEqual(blocks, [
    { type: "paragraph", text: "Apresento as formas no presente:" },
    {
      type: "conjugation",
      verb: "ESSERE",
      translation: "ser/estar",
      rows: [{ subject: "io", form: "sono" }, { subject: "tu", form: "sei" }],
    },
    {
      type: "conjugation",
      verb: "AVERE",
      translation: "ter",
      rows: [{ subject: "io", form: "ho" }, { subject: "tu", form: "hai" }],
    },
  ]);
});

test("rascunhos de onboarding são isolados por usuário", () => {
  const firstUser = onboardingStorageKeys("user-a");
  const secondUser = onboardingStorageKeys("user-b");

  assert.notEqual(firstUser.draft, secondUser.draft);
  assert.notEqual(firstUser.step, secondUser.step);
  assert.equal(firstUser.draft, "lume:onboarding-draft:user-a");
});

test("cenário selecionado é isolado por usuário", () => {
  assert.notEqual(scenarioStorageKey("user-a"), scenarioStorageKey("user-b"));
});

test("sessão sem confirmação de email não autentica o usuário", () => {
  assert.equal(isEmailConfirmed(null), false);
  assert.equal(isEmailConfirmed({ email_confirmed_at: null }), false);
});

test("email confirmado é identificado pelo timestamp do Supabase", () => {
  assert.equal(isEmailConfirmed({ email_confirmed_at: "2026-07-30T12:00:00Z" }), true);
});

test("redirect de recuperação usa query string sem competir com tokens no hash", () => {
  assert.equal(
    passwordRecoveryRedirectUrl("https://ai-language-tutor.caps-labs.com/"),
    "https://ai-language-tutor.caps-labs.com/?auth=recovery",
  );
});

test("callback de recuperação aceita marcador próprio e evento implícito do Supabase", () => {
  assert.equal(isPasswordRecoveryCallback("", "?auth=recovery"), true);
  assert.equal(isPasswordRecoveryCallback("#access_token=token&type=recovery", ""), true);
  assert.equal(isPasswordRecoveryCallback("#/login", ""), false);
});

test("senha nova segue a política de segurança", () => {
  assert.match(validateNewPassword("curta") || "", /12/);
  assert.match(validateNewPassword("somenteletrasminusculas") || "", /maiúscula/);
  assert.equal(validateNewPassword("Frase-Segura-2026!"), null);
});

test("migration contém o catálogo completo que será carregado do Supabase", () => {
  const shortContentMigration = readFileSync(
    new URL("../../supabase/migrations/20260731121000_seed_learning_content.sql", import.meta.url),
    "utf8",
  );
  const readingMigration = readFileSync(
    new URL("../../supabase/migrations/20260731123000_seed_reading_passages.sql", import.meta.url),
    "utf8",
  );
  const readingClozeMigration = readFileSync(
    new URL("../../supabase/migrations/20260803161000_text_aligned_reading_cloze.sql", import.meta.url),
    "utf8",
  );
  const quickLessonClozeMigration = readFileSync(
    new URL("../../supabase/migrations/20260803160000_topic_aligned_quick_lesson_cloze.sql", import.meta.url),
    "utf8",
  );
  const grammarTopicsMigration = readFileSync(
    new URL("../../supabase/migrations/20260731125000_seed_grammar_topics.sql", import.meta.url),
    "utf8",
  );
  assert.equal(shortContentMigration.match(/'(?:en|es|fr|it)-reading-/g)?.length, 160);
  assert.equal(shortContentMigration.match(/'(?:en|es|fr|it)-grammar-/g)?.length, 200);
  assert.equal(shortContentMigration.match(/'(?:en|es|fr|it)-flashcard-/g)?.length, 200);
  assert.equal(readingMigration.match(/'(?:en|es|fr|it)-passage-/g)?.length, 160);
  assert.equal(grammarTopicsMigration.match(/'(?:en|es|fr|it)-grammar-(?:A1|A2|B1|B2)-\d+'/g)?.length, 40);
  assert.ok((grammarTopicsMigration.match(/"title_pt_br":/g)?.length || 0) >= 80);
  assert.ok((grammarTopicsMigration.match(/"incorrect":/g)?.length || 0) >= 80);

  const firstPassage = readingMigration.indexOf("('en-passage-");
  const passageRows = readingMigration.slice(firstPassage).split(/\n(?=\('(?:en|es|fr|it)-passage-)/);
  for (const level of ["a1", "a2", "b1", "b2"]) {
    const rows = passageRows.filter((row) => row.startsWith(`('en-passage-${level}-`)
      || row.startsWith(`('es-passage-${level}-`)
      || row.startsWith(`('fr-passage-${level}-`)
      || row.startsWith(`('it-passage-${level}-`));
    assert.equal(rows.length, 40);
    rows.forEach((row) => {
      if (level === "b1" || level === "b2") {
        assert.ok((row.match(/\n\n/g)?.length || 0) >= 4);
      }
    });
  }

  const advancedMixedMigration = readFileSync(
    new URL("../../supabase/migrations/20260803170000_advanced_b1_b2_mixed_exercises.sql", import.meta.url),
    "utf8",
  );

  assert.equal(
    (readingClozeMigration.match(/update public\.reading_passages set/g) || []).length,
    160,
  );
  assert.match(readingClozeMigration, /A1=3, A2=4, B1=6, B2=8/);

  // Advanced migration upgrades all readings/quick lessons and B1/B2 grammar.
  assert.equal(
    (advancedMixedMigration.match(/update public\.reading_passages set/g) || []).length,
    160,
  );
  assert.equal(
    (advancedMixedMigration.match(/update public\.quick_lessons set/g) || []).length,
    800,
  );
  assert.ok((advancedMixedMigration.match(/update public\.grammar_exercises set/g) || []).length >= 700);
  assert.ok(advancedMixedMigration.includes("What is the main idea of the text?"));
  assert.ok(advancedMixedMigration.includes("Which sentence correctly uses"));

  for (const [level, count] of [["a1", 3], ["a2", 4], ["b1", 6], ["b2", 8]] as const) {
    const sampleId = `en-passage-${level}-01`;
    const sampleIndex = advancedMixedMigration.indexOf(`where id = '${sampleId}'`);
    assert.ok(sampleIndex > 0);
    const assignmentStart = advancedMixedMigration.lastIndexOf("questions = '", sampleIndex);
    assert.ok(assignmentStart > 0 && assignmentStart < sampleIndex);
    const sampleBlock = advancedMixedMigration.slice(assignmentStart, sampleIndex);
    const promptMatches = sampleBlock.match(/"prompt": "/g) || [];
    assert.equal(promptMatches.length, count);
    if (level === "a1" || level === "a2") {
      assert.equal((sampleBlock.match(/"prompt": "Complete:/g) || []).length, count);
    } else {
      assert.ok((sampleBlock.match(/"prompt": "Complete:/g) || []).length >= 1);
      assert.ok((sampleBlock.match(/"prompt": "Complete:/g) || []).length < count);
    }
  }

  assert.ok(quickLessonClozeMigration.includes("add column if not exists questions jsonb"));
  assert.match(quickLessonClozeMigration, /A1=2, A2=3, B1=4, B2=5/);
  assert.equal(
    (quickLessonClozeMigration.match(/update public\.quick_lessons set/g) || []).length,
    800,
  );
});

test("dashboard calcula sequência, semana e progresso diário com atividades reais", () => {
  const metrics = calculateDashboardMetrics([
    "2026-07-27T12:00:00-03:00",
    "2026-07-28T12:00:00-03:00",
    "2026-07-29T12:00:00-03:00",
    "2026-07-30T09:00:00-03:00",
    "2026-07-30T10:00:00-03:00",
  ], 5, new Date("2026-07-30T15:00:00-03:00"));

  assert.equal(metrics.streak, 4);
  assert.equal(metrics.activeDaysThisWeek, 4);
  assert.equal(metrics.completedToday, 2);
  assert.equal(metrics.activitiesThisMonth, 5);
  assert.equal(metrics.weeklyPercent, 80);
});

test("sequência permanece válida quando o usuário ainda não estudou hoje", () => {
  const metrics = calculateDashboardMetrics([
    "2026-07-28T12:00:00-03:00",
    "2026-07-29T12:00:00-03:00",
  ], 3, new Date("2026-07-30T08:00:00-03:00"));

  assert.equal(metrics.streak, 2);
  assert.equal(metrics.completedToday, 0);
});

test("sequência conta ontem e hoje como dois dias consecutivos", () => {
  const metrics = calculateDashboardMetrics([
    "2026-07-30T23:30:00-03:00",
    "2026-07-31T08:00:00-03:00",
  ], 5, new Date("2026-07-31T12:00:00-03:00"));

  assert.equal(metrics.streak, 2);
});

test("cronômetro e progresso da conversa usam valores reais da sessão", () => {
  assert.equal(formatElapsed(0), "00:00");
  assert.equal(formatElapsed(625), "10:25");
  assert.equal(sessionProgressPercent(4, 10, 30), 31);
  assert.equal(sessionProgressPercent(30, 10, 30), 100);
});

test("cenário recomendado respeita a faixa do nível do aluno", () => {
  const scenarios = [
    { id: "advanced", minLevel: "B1", maxLevel: "B2" },
    { id: "basic", minLevel: "A1", maxLevel: "A2" },
  ] as ScenarioCatalogItem[];
  assert.equal(recommendScenario(scenarios, "A2")?.id, "basic");
  assert.equal(recommendScenario(scenarios, "B2")?.id, "advanced");
});
