// Sites whose logged-in account can be detected by the extension's getters (src/sync/account).
// Kept in sync with src/main/account-getters.entry.ts.
export const ACCOUNT_GETTER_HOMES: Record<string, string> = {
  x: "https://x.com",
  tiktok: "https://www.tiktok.com",
  douyin: "https://creator.douyin.com",
  rednote: "https://creator.xiaohongshu.com",
  bilibili: "https://t.bilibili.com",
  qie: "https://om.qq.com",
  chejiahao: "https://creator.autohome.com.cn",
  dewu: "https://creator.dewu.com",
  yiche: "https://mp.yiche.com/",
  sohu: "https://mp.sohu.com",
  netease: "https://dy.163.com",
  dayu: "https://mp.dayu.com",
  alipay: "https://b.alipay.com",
  yidian: "https://yidian.com",
  pinduoduo: "https://pinduoduo.com",
  vivovideo: "https://video.vivo.com.cn",
};

export const ACCOUNT_GETTER_KEYS = Object.keys(ACCOUNT_GETTER_HOMES);

// Login landing pages that are better than the platform's publish page.
export const SITE_HOME_OVERRIDES: Record<string, string> = {
  x: "https://x.com/login",
};
