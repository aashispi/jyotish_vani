/**
 * lib/sarvam.ts
 *
 * Thin wrapper around Sarvam AI APIs:
 *  - /translate  → English → Indian language
 *  - /text-to-speech (optional, for voice output)
 *
 * Docs: https://docs.sarvam.ai
 */

const SARVAM_API_KEY = process.env.SARVAM_API_KEY!;
const SARVAM_BASE = "https://api.sarvam.ai";

export type SarvamLanguageCode =
  | "hi-IN"   // Hindi
  | "bn-IN"   // Bengali
  | "ta-IN"   // Tamil
  | "te-IN"   // Telugu
  | "mr-IN"   // Marathi
  | "kn-IN"   // Kannada
  | "ml-IN"   // Malayalam
  | "gu-IN"   // Gujarati
  | "pa-IN"   // Punjabi
  | "or-IN";  // Odia

/**
 * Translate text from English to the target Indian language using Sarvam.
 * Falls back gracefully to the original text on error.
 */
export async function translateToIndian(
  text: string,
  targetLang: SarvamLanguageCode
): Promise<string> {
  if (!SARVAM_API_KEY) {
    console.warn("SARVAM_API_KEY not set, skipping translation.");
    return text;
  }

  try {
    const res = await fetch(`${SARVAM_BASE}/translate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": SARVAM_API_KEY,
      },
      body: JSON.stringify({
        input: text,
        source_language_code: "en-IN",
        target_language_code: targetLang,
        speaker_gender: "Male",
        mode: "formal",
        model: "mayura:v1",                  // Sarvam's best translation model
        enable_preprocessing: true,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Sarvam translate error ${res.status}: ${err}`);
    }

    const data = await res.json();
    return data.translated_text ?? text;
  } catch (e) {
    console.error("Translation failed:", e);
    return text; // graceful fallback
  }
}

/**
 * Detect if the user's message is in an Indian language and return the
 * Sarvam language code, or null if English.
 *
 * Uses Sarvam's /identify-language endpoint.
 */
export async function detectLanguage(
  text: string
): Promise<SarvamLanguageCode | null> {
  if (!SARVAM_API_KEY) return null;

  try {
    const res = await fetch(`${SARVAM_BASE}/text-analytics/identify-language`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": SARVAM_API_KEY,
      },
      body: JSON.stringify({ input: text }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const lang = data.language_code as string;

    // Return null for English so we skip translation
    if (!lang || lang === "en-IN" || lang === "en") return null;
    return lang as SarvamLanguageCode;
  } catch {
    return null;
  }
}
