import type { SupabaseClient } from "@supabase/supabase-js";

export type LearningLanguage = "en" | "es" | "fr" | "it";
export type LearningLevel = "A1" | "A2" | "B1" | "B2";

export type QuickLessonQuestion = {
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
};

export type QuickLessonActivity = {
  id: string;
  language: LearningLanguage;
  level: LearningLevel;
  title: string;
  text: string;
  questions: QuickLessonQuestion[];
};

export type ReadingQuestion = {
  prompt: string;
  options: string[];
  answer: number;
  explanation: string;
};

export type ReadingPassage = {
  id: string;
  language: LearningLanguage;
  level: LearningLevel;
  title: string;
  paragraphs: string[];
  questions: ReadingQuestion[];
};

export type GrammarExample = {
  target: string;
  translation: string;
};

export type GrammarUseCase = {
  title: string;
  explanation: string;
  examples: GrammarExample[];
};

export type GrammarMistake = {
  incorrect: string;
  correct: string;
  explanation: string;
};

export type GrammarTopic = {
  id: string;
  language: LearningLanguage;
  level: LearningLevel;
  title: string;
  overview: string;
  formation: string;
  useCases: GrammarUseCase[];
  commonMistakes: GrammarMistake[];
  notes: string[];
};

export type GrammarExercise = {
  id: string;
  topicId: string;
  language: LearningLanguage;
  level: LearningLevel;
  title: string;
  question: string;
  options: string[];
  answer: number;
};

export type ReviewItem = {
  id: string;
  level: LearningLevel;
  sourceType: "quick_lesson" | "reading" | "grammar" | "conversation";
  prompt: string;
  learnerAnswer: string;
  correctAnswer: string;
  explanation: string;
};

export type LearningContent = {
  quickLessons: QuickLessonActivity[];
  readings: ReadingPassage[];
  grammarTopics: GrammarTopic[];
  grammarExercises: GrammarExercise[];
  flashcards: ReviewItem[];
};

export type LearningSection = "quick_lesson" | "reading" | "grammar";

export type LearningSectionProgress = {
  language: LearningLanguage;
  section: LearningSection;
  level: LearningLevel;
  activityId: string;
  stepIndex: number;
  correctAnswers: number;
  view: "activity" | "explanations" | "exercises";
};

export type LearnerLearningProgress = {
  completedActivityIds: string[];
  sections: LearningSectionProgress[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function normalizeGrammarUseCases(value: unknown): GrammarUseCase[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (typeof item === "string" && item.trim()) {
      return [{ title: `Caso ${index + 1}`, explanation: item.trim(), examples: [] }];
    }
    if (!isRecord(item)) return [];
    const rawExamples = Array.isArray(item.examples) ? item.examples : [];
    const examples = rawExamples.flatMap((example) => {
      if (typeof example === "string" && example.trim()) {
        return [{ target: example.trim(), translation: "" }];
      }
      if (!isRecord(example)) return [];
      const target = textValue(example.target);
      if (!target) return [];
      return [{
        target,
        translation: textValue(example.translation_pt_br ?? example.translation),
      }];
    });
    return [{
      title: textValue(item.title_pt_br ?? item.title, `Caso ${index + 1}`),
      explanation: textValue(item.explanation_pt_br ?? item.explanation),
      examples,
    }];
  });
}

export function normalizeGrammarMistakes(value: unknown): GrammarMistake[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) {
      return [{ incorrect: "Evite", correct: "Forma recomendada", explanation: item.trim() }];
    }
    if (!isRecord(item)) return [];
    const explanation = textValue(item.explanation_pt_br ?? item.explanation);
    const incorrect = textValue(item.incorrect, "Evite");
    const correct = textValue(item.correct, "Forma recomendada");
    if (!explanation && incorrect === "Evite" && correct === "Forma recomendada") return [];
    return [{ incorrect, correct, explanation }];
  });
}

export function normalizeGrammarNotes(value: unknown): string[] {
  if (!Array.isArray(value)) return typeof value === "string" && value.trim() ? [value.trim()] : [];
  return value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) return [item.trim()];
    if (!isRecord(item)) return [];
    const note = textValue(item.note ?? item.text ?? item.explanation_pt_br ?? item.explanation);
    return note ? [note] : [];
  });
}

export async function loadLearnerLearningProgress(
  supabase: SupabaseClient,
  userId: string,
): Promise<LearnerLearningProgress> {
  const [completedResult, sectionsResult] = await Promise.all([
    supabase
      .from("learning_activity_progress")
      .select("activity_id")
      .eq("user_id", userId),
    supabase
      .from("learning_section_progress")
      .select("language,section,level,activity_id,step_index,correct_answers,view")
      .eq("user_id", userId),
  ]);
  if (completedResult.error) throw completedResult.error;
  if (sectionsResult.error) throw sectionsResult.error;
  return {
    completedActivityIds: (completedResult.data || []).map(({ activity_id }) => activity_id),
    sections: (sectionsResult.data || []).map((row) => ({
      language: row.language as LearningLanguage,
      section: row.section as LearningSection,
      level: row.level as LearningLevel,
      activityId: row.activity_id,
      stepIndex: row.step_index,
      correctAnswers: row.correct_answers,
      view: row.view as LearningSectionProgress["view"],
    })),
  };
}

export async function loadLearningContent(
  supabase: SupabaseClient,
  language: LearningLanguage,
): Promise<LearningContent> {
  const [
    quickLessonsResult,
    readingsResult,
    grammarTopicsResult,
    grammarExercisesResult,
    flashcardsResult,
  ] = await Promise.all([
    supabase
      .from("quick_lessons")
      .select("id,language,level,title,body,question,options,answer_index,questions")
      .eq("language", language)
      .eq("is_published", true)
      .order("sort_order"),
    supabase
      .from("reading_passages")
      .select("id,language,level,title,body,questions")
      .eq("language", language)
      .eq("is_published", true)
      .order("sort_order"),
    supabase
      .from("grammar_topics")
      .select("id,language,level,title,overview_pt_br,formation_pt_br,use_cases,common_mistakes,notes_pt_br")
      .eq("language", language)
      .eq("is_published", true)
      .order("sort_order"),
    supabase
      .from("grammar_exercises")
      .select("id,topic_id,language,level,title,question,options,answer_index")
      .eq("language", language)
      .eq("is_published", true)
      .order("sort_order"),
    supabase
      .from("review_flashcards")
      .select("id,level,front,back")
      .eq("language", language)
      .eq("is_published", true)
      .order("sort_order"),
  ]);

  const error = quickLessonsResult.error
    || readingsResult.error
    || grammarTopicsResult.error
    || grammarExercisesResult.error
    || flashcardsResult.error;
  if (error) throw error;

  const content: LearningContent = {
    quickLessons: (quickLessonsResult.data || []).map((row) => {
      const legacyQuestion = {
        prompt: row.question as string,
        options: row.options as string[],
        answer: row.answer_index as number,
        explanation: "",
      };
      const rawQuestions = row.questions as Array<{
        prompt: string;
        options: string[];
        answer_index: number;
        explanation_pt_br?: string;
      }> | null;
      const questions = rawQuestions && rawQuestions.length > 0
        ? rawQuestions.map((question) => ({
          prompt: question.prompt,
          options: question.options,
          answer: question.answer_index,
          explanation: question.explanation_pt_br || "",
        }))
        : [legacyQuestion];
      return {
        id: row.id,
        language: row.language as LearningLanguage,
        level: row.level as LearningLevel,
        title: row.title,
        text: row.body,
        questions,
      };
    }),
    readings: (readingsResult.data || []).map((row) => ({
      id: row.id,
      language: row.language as LearningLanguage,
      level: row.level as LearningLevel,
      title: row.title,
      paragraphs: row.body.split(/\n\s*\n/).filter(Boolean),
      questions: (row.questions as Array<{
        prompt: string;
        options: string[];
        answer_index: number;
        explanation_pt_br: string;
      }>).map((question) => ({
        prompt: question.prompt,
        options: question.options,
        answer: question.answer_index,
        explanation: question.explanation_pt_br,
      })),
    })),
    grammarTopics: (grammarTopicsResult.data || []).map((row) => ({
      id: row.id,
      language: row.language as LearningLanguage,
      level: row.level as LearningLevel,
      title: row.title,
      overview: row.overview_pt_br,
      formation: row.formation_pt_br,
      useCases: normalizeGrammarUseCases(row.use_cases),
      commonMistakes: normalizeGrammarMistakes(row.common_mistakes),
      notes: normalizeGrammarNotes(row.notes_pt_br),
    })),
    grammarExercises: (grammarExercisesResult.data || []).map((row) => ({
      id: row.id,
      topicId: row.topic_id,
      language: row.language as LearningLanguage,
      level: row.level as LearningLevel,
      title: row.title,
      question: row.question,
      options: row.options as string[],
      answer: row.answer_index,
    })),
    flashcards: [],
  };

  const levels: LearningLevel[] = ["A1", "A2", "B1", "B2"];
  const incomplete = levels.some(
    (level) =>
      !content.quickLessons.some((item) => item.level === level)
      || !content.readings.some((item) => item.level === level)
      || !content.grammarTopics.some((item) => item.level === level)
      || !content.grammarExercises.some((item) => item.level === level),
  );
  if (incomplete) throw new Error("Learning catalog is incomplete");

  return content;
}

export async function loadReviewItems(
  supabase: SupabaseClient,
  language: LearningLanguage,
): Promise<ReviewItem[]> {
  const { data, error } = await supabase
    .from("learner_review_items")
    .select("id,level,source_type,prompt,learner_answer,correct_answer,explanation_pt_br")
    .eq("language", language)
    .eq("status", "pending")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((item) => ({
    id: item.id,
    level: item.level as LearningLevel,
    sourceType: item.source_type as ReviewItem["sourceType"],
    prompt: item.prompt,
    learnerAnswer: item.learner_answer,
    correctAnswer: item.correct_answer,
    explanation: item.explanation_pt_br,
  }));
}
