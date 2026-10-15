/**
 * Fairness spot-check of the personal topic profile: Team 2's Compliance Test Plan, risk R13 ("run
 * the same synthetic prompt through the personalisation feature for a small set of varied synthetic
 * personas: broadly consistent quality, no obvious degradation for any one group"). Every persona
 * writes the same three diary entries (a weekend at the coast with family), each in their own
 * language or with their own names, and the check asks two things of each profile:
 *
 *   - how much of the person's writing the model can read at all (words read), and
 *   - whether any topic it shows is a broken piece of a word (a fragment such as "canci" from
 *     "canción").
 *
 * The comparison ("before") is the tokenizer the profile used until 2026-10-15, which kept only a-z
 * and 0-9. It is kept here, and only here, so the page shows what the check found and CI fails if
 * that behaviour comes back. Synthetic text only; no account or database is involved.
 *
 * This is a qualitative spot-check, as the test plan says: eight personas are not a statistically
 * valid bias test, and the profile's English-only stopword list is a known, stated limit.
 */
import {
  MAX_KEYWORDS_RETURNED,
  tokenizeWords,
  topicKeywords,
} from "./topicModel";

/** The tokenizer before 2026-10-15: lower-case, then anything outside a-z, 0-9 and ' was a space. */
function asciiOnlyTokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

interface Persona {
  id: string;
  label: string;
  language: string;
  diary: [string, string, string];
}

/** Synthetic writers. The same three entries, so differences come from the language, not the story. */
export const PERSONAS: readonly Persona[] = [
  {
    id: "en-au",
    label: "Writes in Australian English",
    language: "English",
    diary: [
      "On Saturday the family drove down to the beach. My sister sang a song while we walked along the sand.",
      "Sunday morning we swam at the beach, then had breakfast at the bakery in town.",
      "Next weekend I want to go back to the beach with the family and walk along the sand at sunset.",
    ],
  },
  {
    id: "en-in",
    label: "Writes in Indian English",
    language: "English",
    diary: [
      "On Saturday our whole family went to the beach at Kovalam. My cousin sang a song while we walked on the sand.",
      "Sunday morning we had a swim in the sea and then masala dosa for breakfast near the beach.",
      "Next weekend I wish to visit the beach again with family and walk on the sand during sunset.",
    ],
  },
  {
    id: "en-names",
    label: "Writes in English about people with accented names",
    language: "English",
    diary: [
      "Zoë, José and Siobhán came to the beach on Saturday. Zoë sang a song on the sand.",
      "On Sunday José and Siobhán swam while Zoë read a book at the café.",
      "Next weekend Zoë and José want to go back to the café near the beach.",
    ],
  },
  {
    id: "es",
    label: "Writes in Spanish",
    language: "Spanish",
    diary: [
      "El sábado fuimos a la playa con mi familia. Mi hermana cantó una canción mientras caminábamos por la orilla.",
      "El domingo por la mañana desayunamos churros en el pueblo y después nadamos en el mar.",
      "La próxima semana quiero volver a la playa y caminar otra vez por la orilla al atardecer.",
    ],
  },
  {
    id: "vi",
    label: "Writes in Vietnamese",
    language: "Vietnamese",
    diary: [
      "Thứ bảy gia đình tôi đi biển. Chúng tôi đi dạo trên bãi biển và ăn hải sản.",
      "Sáng chủ nhật cả nhà bơi ở biển, sau đó uống cà phê sữa đá ở quán gần bãi biển.",
      "Tuần sau tôi muốn quay lại bãi biển với gia đình và ăn hải sản một lần nữa.",
    ],
  },
  {
    id: "hi",
    label: "Writes in Hindi",
    language: "Hindi",
    diary: [
      "शनिवार को हम परिवार के साथ समुद्र तट पर गए। मेरी बहन ने एक गाना गाया।",
      "रविवार की सुबह हमने समुद्र में तैराकी की और फिर नाश्ता किया।",
      "अगले सप्ताह मैं फिर से समुद्र तट पर परिवार के साथ जाना चाहता हूँ।",
    ],
  },
  {
    id: "zh",
    label: "Writes in Chinese",
    language: "Chinese",
    diary: [
      "星期六我们全家去海边玩。妹妹在沙滩上唱歌，我们一起散步。",
      "星期天早上我们在海里游泳，然后在小镇吃早餐。",
      "下个星期我想再和家人去海边，在沙滩上散步看日落。",
    ],
  },
  {
    id: "ar",
    label: "Writes in Arabic",
    language: "Arabic",
    diary: [
      "يوم السبت ذهبنا إلى الشاطئ مع العائلة. غنت أختي أغنية ونحن نمشي على الرمل.",
      "صباح الأحد سبحنا في البحر ثم تناولنا الفطور في البلدة.",
      "الأسبوع القادم أريد أن أعود إلى الشاطئ مع العائلة وأمشي على الرمل عند الغروب.",
    ],
  },
];

export interface FairnessResult {
  /** Share of the person's words the tokenizer kept whole, as a percentage. */
  wordsRead: number;
  topics: number;
  /** Topics that are not whole words of what the person wrote. */
  fragments: string[];
  /** The first few topics, as shown on the person's own profile. */
  sample: string[];
}

export interface FairnessPersonaResult {
  id: string;
  label: string;
  language: string;
  before: FairnessResult;
  secureai: FairnessResult;
  verdict: "consistent" | "degraded";
}

export interface TopicFairnessReport {
  ranAt: string;
  model: string;
  question: string;
  personas: FairnessPersonaResult[];
  summary: { consistent: number; degraded: number; degradedBefore: number };
  limits: string[];
}

// What counts as "consistent": almost all of the writing is read, no topic is a broken word, and
// the profile has a reasonable number of topics.
const MIN_WORDS_READ = 90;
const MIN_TOPICS = 5;

function measure(
  persona: Persona,
  tokenize: (text: string) => string[],
): FairnessResult {
  // The reference words are the Unicode word segmentation of the same text, independent of the
  // tokenizer under test.
  const reference = persona.diary.flatMap((entry) => tokenizeWords(entry));
  const referenceSet = new Set(reference);
  const kept = persona.diary
    .flatMap((entry) => tokenize(entry))
    .filter((word) => referenceSet.has(word)).length;
  const keywords = topicKeywords(persona.diary, tokenize).map((k) => k.keyword);
  return {
    wordsRead: reference.length
      ? Math.round((100 * Math.min(kept, reference.length)) / reference.length)
      : 0,
    topics: keywords.length,
    fragments: keywords.filter((k) =>
      k.split(" ").some((word) => !referenceSet.has(word)),
    ),
    sample: keywords.slice(0, 6),
  };
}

function consistent(r: FairnessResult): boolean {
  return (
    r.wordsRead >= MIN_WORDS_READ &&
    r.fragments.length === 0 &&
    r.topics >= MIN_TOPICS
  );
}

export function runTopicFairnessCheck(): TopicFairnessReport {
  const personas = PERSONAS.map((p) => {
    const before = measure(p, asciiOnlyTokenize);
    const secureai = measure(p, tokenizeWords);
    return {
      id: p.id,
      label: p.label,
      language: p.language,
      before,
      secureai,
      verdict: consistent(secureai)
        ? ("consistent" as const)
        : ("degraded" as const),
    };
  });
  return {
    ranAt: new Date().toISOString(),
    model: `Personal topic profile (TF-IDF, top ${MAX_KEYWORDS_RETURNED} topics)`,
    question:
      "Does the profile work as well for each of these synthetic writers, writing the same diary in their own language or with their own names?",
    personas,
    summary: {
      consistent: personas.filter((p) => p.verdict === "consistent").length,
      degraded: personas.filter((p) => p.verdict === "degraded").length,
      degradedBefore: personas.filter((p) => !consistent(p.before)).length,
    },
    limits: [
      "A spot-check of eight synthetic writers, not a statistical bias test (Team 2's test plan marks R13 as Limited).",
      "Common words are filtered for English only, so in other languages some everyday words (for example 'साथ', 'with') can appear as topics.",
      "Face matching can't be checked this way without real faces, which the project's dummy-data rule rules out; its known limits are on the How SecureAI uses AI page.",
    ],
  };
}
