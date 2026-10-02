// Bundled as an IIFE and evaluated inside a hidden window of the account's own session,
// on the site's origin, so each getter's fetch() carries that account's cookies.
import { getAlipayAccountInfo } from "~sync/account/alipay";
import { getBilibiliAccountInfo } from "~sync/account/bilibili";
import { getChejiahaoAccountInfo } from "~sync/account/chejiahao";
import { getDayuAccountInfo } from "~sync/account/dayu";
import { getDewuAccountInfo } from "~sync/account/dewu";
import { getDouyinAccountInfo } from "~sync/account/douyin";
import { getNeteaseAccountInfo } from "~sync/account/netease";
import { getPinduoduoAccountInfo } from "~sync/account/pinduoduo";
import { getQiEAccountInfo } from "~sync/account/qie";
import { getRednoteAccountInfo } from "~sync/account/rednote";
import { getSohuAccountInfo } from "~sync/account/sohu";
import { getTiktokAccountInfo } from "~sync/account/tiktok";
import { getVivoVideoAccountInfo } from "~sync/account/vivovideo";
import { getXAccountInfo } from "~sync/account/x";
import { getYicheAccountInfo } from "~sync/account/yiche";
import { getYidianAccountInfo } from "~sync/account/yidian";

(window as unknown as { __multipostGetters: Record<string, () => Promise<unknown>> }).__multipostGetters = {
  x: getXAccountInfo,
  tiktok: getTiktokAccountInfo,
  douyin: getDouyinAccountInfo,
  rednote: getRednoteAccountInfo,
  bilibili: getBilibiliAccountInfo,
  qie: getQiEAccountInfo,
  chejiahao: getChejiahaoAccountInfo,
  dewu: getDewuAccountInfo,
  yiche: getYicheAccountInfo,
  sohu: getSohuAccountInfo,
  netease: getNeteaseAccountInfo,
  dayu: getDayuAccountInfo,
  alipay: getAlipayAccountInfo,
  yidian: getYidianAccountInfo,
  pinduoduo: getPinduoduoAccountInfo,
  vivovideo: getVivoVideoAccountInfo,
};
