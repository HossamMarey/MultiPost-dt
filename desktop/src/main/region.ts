// "Match proxy location": asks a public IP-geolocation service — through this account's own session and
// proxy, only when the user clicks the button — which timezone and country the account appears to be in.
import { session } from "electron";
import { sessionForAccount } from "./sessions";
import { getState, update } from "./store";

// Most common language per country for Accept-Language / Intl (fallback: en-US).
const COUNTRY_LOCALE: Record<string, string> = {
  US: "en-US",
  GB: "en-GB",
  CA: "en-CA",
  AU: "en-AU",
  NZ: "en-NZ",
  IE: "en-IE",
  IN: "en-IN",
  SG: "en-SG",
  CN: "zh-CN",
  TW: "zh-TW",
  HK: "zh-HK",
  JP: "ja-JP",
  KR: "ko-KR",
  DE: "de-DE",
  AT: "de-AT",
  CH: "de-CH",
  FR: "fr-FR",
  BE: "fr-BE",
  ES: "es-ES",
  MX: "es-MX",
  AR: "es-AR",
  CO: "es-CO",
  IT: "it-IT",
  PT: "pt-PT",
  BR: "pt-BR",
  NL: "nl-NL",
  SE: "sv-SE",
  NO: "nb-NO",
  DK: "da-DK",
  FI: "fi-FI",
  PL: "pl-PL",
  RU: "ru-RU",
  UA: "uk-UA",
  TR: "tr-TR",
  EG: "ar-EG",
  SA: "ar-SA",
  AE: "ar-AE",
  MA: "ar-MA",
  IL: "he-IL",
  ID: "id-ID",
  MY: "ms-MY",
  TH: "th-TH",
  VN: "vi-VN",
  PH: "en-PH",
  ZA: "en-ZA",
  NG: "en-NG",
  KE: "en-KE",
  PK: "en-PK",
};

export async function detectRegion(
  accountId: string,
): Promise<{ timezone: string; locale: string; ip: string; country: string }> {
  const account = getState().accounts.find((a) => a.id === accountId);
  if (!account) throw new Error("Account not found");
  await sessionForAccount(account); // make sure the account's proxy is applied
  const ses = session.fromPartition(account.partition);
  const res = await ses.fetch("https://ipwho.is/?fields=ip,success,message,country_code,timezone", {
    credentials: "omit",
    cache: "no-store",
  });
  const data = (await res.json()) as {
    success?: boolean;
    message?: string;
    ip?: string;
    country_code?: string;
    timezone?: { id?: string };
  };
  if (!data.success || !data.timezone?.id) throw new Error(data.message || "Could not detect the location");
  const locale = COUNTRY_LOCALE[data.country_code ?? ""] ?? "en-US";
  update((s) => {
    const a = s.accounts.find((x) => x.id === accountId);
    if (a) {
      a.timezone = data.timezone!.id;
      a.locale = locale;
    }
  });
  return { timezone: data.timezone.id, locale, ip: data.ip ?? "", country: data.country_code ?? "" };
}
