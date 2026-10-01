// Offline brand marks (simple-icons, CC0) so sites are recognizable without network access.
import {
  siAlibabacloud,
  siAlipay,
  siBaidu,
  siBilibili,
  siBluesky,
  siCsdn,
  siDouban,
  siFacebook,
  siInfoq,
  siInstagram,
  siJuejin,
  siKuaishou,
  siMedium,
  siNeteasecloudmusic,
  siPinterest,
  siQq,
  siReddit,
  siSinaweibo,
  siSpotify,
  siSubstack,
  siThreads,
  siTiktok,
  siV2ex,
  siWechat,
  siWordpress,
  siX,
  siXiaohongshu,
  siYoutube,
  siZhihu,
} from "simple-icons";

export interface BrandIcon {
  path: string;
  hex: string;
}

// LinkedIn is not in simple-icons; this is a plain "in" mark.
const LINKEDIN: BrandIcon = {
  hex: "0A66C2",
  path: "M5.3 8.6h3v10h-3zM6.8 4a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5zM10.2 8.6h2.9V10h.04c.4-.76 1.38-1.56 2.85-1.56 3.05 0 3.61 2 3.61 4.62v5.54h-3v-4.9c0-1.17-.02-2.68-1.63-2.68-1.64 0-1.89 1.28-1.89 2.6v4.98h-3z",
};

export const BRAND_ICONS: Record<string, BrandIcon> = {
  x: siX,
  bilibili: siBilibili,
  weibo: siSinaweibo,
  zhihu: siZhihu,
  tiktok: siTiktok,
  douyin: siTiktok,
  douban: siDouban,
  juejin: siJuejin,
  csdn: siCsdn,
  instagram: siInstagram,
  facebook: siFacebook,
  threads: siThreads,
  linkedin: LINKEDIN,
  reddit: siReddit,
  pinterest: siPinterest,
  bluesky: siBluesky,
  medium: siMedium,
  substack: siSubstack,
  wordpress: siWordpress,
  youtube: siYoutube,
  spotify: siSpotify,
  rednote: siXiaohongshu,
  weixin: siWechat,
  weixinchannel: siWechat,
  v2ex: siV2ex,
  aliyun: siAlibabacloud,
  alipay: siAlipay,
  neteasepodcast: siNeteasecloudmusic,
  kuaishou: siKuaishou,
  baijiahao: siBaidu,
  infoq: siInfoq,
  qqmusic: siQq,
  qie: siQq,
};

// Stable, distinct fallback colors for sites without a bundled mark.
const FALLBACK = [
  "#2563eb",
  "#db2777",
  "#059669",
  "#d97706",
  "#7c3aed",
  "#0891b2",
  "#dc2626",
  "#4f46e5",
  "#65a30d",
  "#c026d3",
];

export function fallbackColor(key: string): string {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
}
