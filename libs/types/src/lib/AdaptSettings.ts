export interface FooterLinks {
  label: string;
  url: string;
  external: boolean;
  target: "newTab" | "sameTab" | "newWindow";
  icon?: string;
  showAdmin?: boolean;
  showPublic?: boolean;
}

export interface AdaptSettings {
  logo: string;
  copyright: string;
  idleMinutes: number;
  nSize: number;
  warningMinutes: number;
  timeoutMinutes: number;
  footerLinks?: FooterLinks[];
  supportedLanguages?: LanguageCode[];
}

export interface AdaptGlossaryTerm {
  definition: string;
  label: string;
}

export interface AdaptGlossary {
  lang: string;
  terms: Record<string, AdaptGlossaryTerm>;
}

export interface UpdateAdaptSettingsInput {
  logo?: string;
  copyright?: string;
  idleMinutes?: number;
  nSize?: number;
  warningMinutes?: number;
  timeoutMinutes?: number;
  footerLinks?: FooterLinks[];
}

export type LanguageCode =
  | "af"
  | "sq"
  | "am"
  | "ar"
  | "hy"
  | "az"
  | "bn"
  | "bs"
  | "bg"
  | "ca"
  | "zh"
  | "zh-TW"
  | "hr"
  | "cs"
  | "da"
  | "fa-AF"
  | "nl"
  | "en"
  | "et"
  | "fa"
  | "tl"
  | "fi"
  | "fr"
  | "fr-CA"
  | "ka"
  | "de"
  | "el"
  | "gu"
  | "ht"
  | "ha"
  | "he"
  | "hi"
  | "hu"
  | "is"
  | "id"
  | "ga"
  | "it"
  | "ja"
  | "kn"
  | "kk"
  | "ko"
  | "lv"
  | "lt"
  | "mk"
  | "ms"
  | "ml"
  | "mt"
  | "mr"
  | "mn"
  | "no"
  | "ps"
  | "pl"
  | "pt"
  | "pt-PT"
  | "pa"
  | "ro"
  | "ru"
  | "sr"
  | "si"
  | "sk"
  | "sl"
  | "so"
  | "es"
  | "es-MX"
  | "sw"
  | "sv"
  | "ta"
  | "te"
  | "th"
  | "tr"
  | "uk"
  | "ur"
  | "uz"
  | "vi"
  | "cy";
