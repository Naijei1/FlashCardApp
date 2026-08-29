/** Options for deck front/back speech voices (BCP-47). */
export const LANGUAGE_OPTIONS = [
  { value: "", label: "Auto / none" },
  { value: "zh-CN", label: "Chinese (Mandarin, simplified)" },
  { value: "zh-TW", label: "Chinese (Mandarin, traditional)" },
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "ja-JP", label: "Japanese" },
  { value: "ko-KR", label: "Korean" },
  { value: "es-ES", label: "Spanish" },
  { value: "fr-FR", label: "French" },
  { value: "de-DE", label: "German" },
];

export const DEFAULT_FRONT_LANG = "zh-CN";
export const DEFAULT_BACK_LANG = "en-US";
